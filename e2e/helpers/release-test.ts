import {
  expect,
  test as base,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";

const REACT_HYDRATION_ERROR_PATTERN =
  /(?:hydration failed because (?:the server rendered|the initial ui does not match)|text content did not match|a tree hydrated but some attributes of the server rendered|this will cause a hydration error|minified react error #418\b)/iu;
const installedPages = new WeakSet<Page>();

// Secret-like substrings are redacted before the message is recorded so a
// hydration error that happens to surface a token in console text can never
// leak it into the manifest or the job log. Mirrors the reporter's
// SECRET_LIKE_VALUE posture.
const SECRET_LIKE_VALUE = /(?:sk_(?:live|test)_|bearer\s+|api[_-]?key|password\s*=|secret\s*=|token\s*=)/giu;
const MAX_MESSAGE_CHARS = 300;
const MAX_URL_CHARS = 256;
const MAX_TITLE_CHARS = 200;

function redactSecrets(value: string): string {
  return value.replace(SECRET_LIKE_VALUE, "[redacted]");
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

type HydrationErrorDetail = {
  source: "console" | "pageerror";
  message: string;
  url: string;
  title: string;
};

function recordHydrationError(
  testInfo: Pick<TestInfo, "annotations" | "title">,
  source: "console" | "pageerror",
  detail: { message: string; url: string },
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
  // The detail annotation rides alongside the source annotation so the
  // manifest reporter can name the surface (message text, page URL, test
  // title) in the deploy-readiness JSON and the job log. Only the first
  // occurrence per source is recorded — the dedup above guarantees that.
  const payload: HydrationErrorDetail = {
    source,
    message: truncate(redactSecrets(detail.message), MAX_MESSAGE_CHARS),
    url: truncate(detail.url, MAX_URL_CHARS),
    title: truncate(testInfo.title ?? "", MAX_TITLE_CHARS),
  };
  testInfo.annotations.push({
    type: "reactHydrationErrorDetail",
    description: JSON.stringify(payload),
  });
}

export function installReleaseHydrationBridge(
  page: Page,
  testInfo: Pick<TestInfo, "annotations" | "title">,
) {
  if (installedPages.has(page)) return () => {};
  installedPages.add(page);

  const onConsole = (message: { type(): string; text(): string }) => {
    if (message.type() !== "error") return;
    if (process.env.HYDRATION_DEBUG === "1") {
      process.stderr.write(`[hydration-debug] console error: ${message.text().slice(0, 500)}\n`);
    }
    if (REACT_HYDRATION_ERROR_PATTERN.test(message.text())) {
      recordHydrationError(testInfo, "console", {
        message: message.text(),
        url: page.url(),
      });
    }
  };
  const onPageError = (error: Error) => {
    if (REACT_HYDRATION_ERROR_PATTERN.test(error.message)) {
      recordHydrationError(testInfo, "pageerror", {
        message: error.message,
        url: page.url(),
      });
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
