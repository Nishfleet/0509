import {
  expect,
  test as base,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";

const REACT_HYDRATION_ERROR_PATTERN =
  /(?:hydration failed because (?:the server rendered|the initial ui does not match)|text content did not match|a tree hydrated but some attributes of the server rendered|this will cause a hydration error|minified react error #418\b)/iu;
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/gu;
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/gu;
const SECRET_VALUE_PATTERN =
  /(sk_(?:live|test)_[A-Za-z0-9_-]+|bearer\s+\S+|(?:api[_-]?key|password|secret|token|cookie|authorization)\s*[=:]\s*\S+)/giu;
const SENSITIVE_QUERY_KEY = /(?:token|secret|password|cookie|authorization|auth|email|key)/iu;
const URL_TOKEN_PATTERN = /^[A-Za-z0-9._~!?$&'()*+,;=:@%/-]+$/u;
const HYDRATION_MESSAGE_LIMIT = 300;
const HYDRATION_TITLE_LIMIT = 160;
const HYDRATION_URL_LIMIT = 256;
const installedPages = new WeakSet<Page>();

type HydrationTestInfo = Pick<TestInfo, "annotations" | "title">;

function sanitizeHydrationMessage(text: string) {
  const cleaned = text
    .replace(ANSI_ESCAPE_PATTERN, " ")
    .replace(CONTROL_CHAR_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, HYDRATION_MESSAGE_LIMIT);
  const redacted = cleaned.replace(SECRET_VALUE_PATTERN, "[redacted]");
  return redacted.length > 0 ? redacted : "unavailable";
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
      if (process.env.HYDRATION_DEBUG === "1") {
        process.stderr.write(`[hydration-debug] url=${page.url()}\n${message.text()}\n`);
      }
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
