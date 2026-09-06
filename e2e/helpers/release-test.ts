import {
  expect,
  test as base,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";

const REACT_HYDRATION_ERROR_PATTERN =
  /(?:hydration failed because (?:the server rendered|the initial ui does not match)|text content did not match|a tree hydrated but some attributes of the server rendered|this will cause a hydration error|minified react error #418\b)/iu;

// Issue #1752: a red run used to report only the source ("console" / "pageerror")
// with no surface to bisect from. The bridge now records a companion detail
// annotation carrying the message text, the page URL and the test title so the
// strict manifest and the deploy job log name the failing page.
const HYDRATION_MESSAGE_LIMIT = 300;
const HYDRATION_TITLE_LIMIT = 160;
const HYDRATION_URL_LIMIT = 256;
// The reporter's safeRelativeUrl also caps pathname at 160, so stay aligned.
const HYDRATION_PATHNAME_LIMIT = 160;
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/gu;
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/gu;
// Keep the captured text out of the strict manifest: real and fixture secrets.
// The bare "apikey"/"api_key"/"api-key" shape is also redacted because the
// reporter's SECRET_LIKE_VALUE rejects it (no value required). Email addresses
// and JWT-shaped strings (eyJ... ) are redacted too since console text can
// quote rendered DOM that includes PII or signed tokens.
const SECRET_VALUE_PATTERN =
  /(sk_(?:live|test)_[A-Za-z0-9_-]+|bearer\s+\S+|api[_-]?key(?:\s*[=:]\s*\S+)?|(?:password|secret|token|cookie|authorization)\s*[=:]\s*\S+|secret=[^\s]+|token=[^\s]+|eyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){1,2}|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/giu;
// The reporter's safeHydrationDetailText rejects these, so strip them here to
// keep the message (e.g. a mismatched <div> from a React #418 line) in the
// manifest instead of dropping the whole entry.
const MANIFEST_UNSAFE_CHARS = /[<>`\\]/gu;
// Hydration messages can quote full URLs (e.g. React #418's "visit ..." text).
// Strip any query string from those URLs so credentials in an ?sig= or ?token=
// parameter do not leak into the manifest or CI log.
const MESSAGE_URL_PATTERN = /https?:\/\/\S+/gu;
const SENSITIVE_QUERY_KEY = /(?:token|secret|password|cookie|authorization|auth|email|key)/iu;
const URL_TOKEN_PATTERN = /^[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/u;
const installedPages = new WeakSet<Page>();

type HydrationTestInfo = Pick<TestInfo, "annotations" | "title">;

function stripUrlQuery(raw: string) {
  try {
    const parsed = new URL(raw);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "[redacted]";
  }
}

function sanitizeHydrationMessage(text: string) {
  const cleaned = text
    .replace(ANSI_ESCAPE_PATTERN, " ")
    .replace(CONTROL_CHAR_PATTERN, " ")
    .replace(MANIFEST_UNSAFE_CHARS, " ")
    .replace(MESSAGE_URL_PATTERN, (match) => stripUrlQuery(match))
    .replace(/\s+/gu, " ")
    .trim();
  // Redact before truncating so a token near the 300-char boundary cannot
  // leave an unmasked prefix, and re-slice after redaction so the reporter's
  // length check stays satisfied.
  const redacted = cleaned.replace(SECRET_VALUE_PATTERN, "[redacted]");
  const truncated = redacted.slice(0, HYDRATION_MESSAGE_LIMIT);
  return truncated.length > 0 ? truncated : "unavailable";
}

function safePageUrl(rawUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const safeSearch = new URLSearchParams();
  for (const [key, value] of parsed.searchParams) {
    if (SENSITIVE_QUERY_KEY.test(key)) continue;
    if (!URL_TOKEN_PATTERN.test(key) || !URL_TOKEN_PATTERN.test(value)) continue;
    safeSearch.append(key, value);
  }
  const search = safeSearch.toString();
  const candidate = `${parsed.pathname}${search ? `?${search}` : ""}`;
  if (parsed.pathname.length > HYDRATION_PATHNAME_LIMIT) return null;
  if (candidate.length <= HYDRATION_URL_LIMIT) return candidate;
  return parsed.pathname.length <= HYDRATION_URL_LIMIT ? parsed.pathname : null;
}

function pageUrl(page: Page) {
  try {
    return typeof page.url === "function" ? safePageUrl(page.url()) : null;
  } catch {
    return null;
  }
}

function recordHydrationError(
  page: Page,
  testInfo: HydrationTestInfo,
  source: "console" | "pageerror",
  text: string,
) {
  if (
    testInfo.annotations.some(
      (annotation) =>
        annotation.type === "reactHydrationError" && annotation.description === source,
    )
  ) {
    return;
  }
  testInfo.annotations.push({ type: "reactHydrationError", description: source });
  const detail = {
    source,
    message: sanitizeHydrationMessage(text),
    url: pageUrl(page),
    title:
      typeof testInfo.title === "string" && testInfo.title.trim().length > 0
        ? testInfo.title.trim().slice(0, HYDRATION_TITLE_LIMIT)
        : null,
  };
  testInfo.annotations.push({
    type: "reactHydrationErrorDetail",
    description: JSON.stringify(detail),
  });
}

export function installReleaseHydrationBridge(
  page: Page,
  testInfo: HydrationTestInfo,
) {
  if (installedPages.has(page)) return () => {};
  installedPages.add(page);

  const onConsole = (message: { type(): string; text(): string }) => {
    if (message.type() !== "error") return;
    if (REACT_HYDRATION_ERROR_PATTERN.test(message.text())) {
      recordHydrationError(page, testInfo, "console", message.text());
    }
  };
  const onPageError = (error: Error) => {
    if (REACT_HYDRATION_ERROR_PATTERN.test(error.message)) {
      recordHydrationError(page, testInfo, "pageerror", error.message);
    }
  };

  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  return () => {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
  };
}

export const test = base.extend<{ releaseHydrationBridge: void }>({
  releaseHydrationBridge: [
    async ({ context }, use, testInfo) => {
      const cleanups = context.pages().map((page) => installReleaseHydrationBridge(page, testInfo));
      const onPage = (page: Page) => cleanups.push(installReleaseHydrationBridge(page, testInfo));
      context.on("page", onPage);
      try {
        await use();
      } finally {
        context.off("page", onPage);
        for (const cleanup of cleanups) cleanup();
      }
    },
    { auto: true },
  ],
});

export { expect };
export type { BrowserContext, Page, TestInfo };
