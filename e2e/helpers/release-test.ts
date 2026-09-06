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

function recordHydrationError(testInfo: Pick<TestInfo, "annotations">, source: "console" | "pageerror") {
  if (
    testInfo.annotations.some(
      (annotation) =>
        annotation.type === "reactHydrationError" && annotation.description === source,
    )
  ) {
    return;
  }
  testInfo.annotations.push({ type: "reactHydrationError", description: source });
}

export function installReleaseHydrationBridge(
  page: Page,
  testInfo: Pick<TestInfo, "annotations">,
) {
  if (installedPages.has(page)) return () => {};
  installedPages.add(page);

  const onConsole = (message: { type(): string; text(): string }) => {
    if (message.type() !== "error") return;
    if (REACT_HYDRATION_ERROR_PATTERN.test(message.text())) {
      process.stderr.write(`DEBUG_HYDRATION_CONSOLE_TEXT: ${message.text()}\n`);
      recordHydrationError(testInfo, "console");
    }
  };
  const onPageError = (error: Error) => {
    if (REACT_HYDRATION_ERROR_PATTERN.test(error.message)) {
      recordHydrationError(testInfo, "pageerror");
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
