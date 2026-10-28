import { expect, test as base, type Page, type TestInfo } from "@playwright/test";

import { consoleFailures, watchConsole, watchRequests, type ConsoleEntry } from "./inbox";

interface Watch {
  page: Page;
  watched: ReturnType<typeof watchConsole>;
  failedRequests: string[];
  documentFailures: Map<string, number>;
}

function watchPage(page: Page): Watch {
  const documentFailures = new Map<string, number>();
  page.on("response", (response) => {
    if (response.status() >= 400 && response.request().resourceType() === "document") {
      documentFailures.set(response.url(), response.status());
    }
  });
  return { page, watched: watchConsole(page), failedRequests: watchRequests(page), documentFailures };
}

function ownDocumentLine(failures: ReadonlyMap<string, number>): (entry: ConsoleEntry) => boolean {
  return (entry) => {
    const status = failures.get(entry.url);
    return status !== undefined && entry.text.includes(`status of ${String(status)}`);
  };
}

export function expectNoise(pattern: RegExp): void {
  base.info().annotations.push({ type: "quiet-exception", description: pattern.toString() });
}

function parseNoise(described: string): RegExp {
  const end = described.lastIndexOf("/");
  return new RegExp(described.slice(1, end), described.slice(end + 1));
}

async function failuresOf(watch: Watch, testInfo: TestInfo, origin: string | null): Promise<string[]> {
  const allowed = testInfo.annotations
    .filter((annotation) => annotation.type === "quiet-exception")
    .map((annotation) => parseNoise(annotation.description ?? ""));
  const unexpected = (line: string) => !allowed.some((pattern) => pattern.test(line));
  const consoleLines = await consoleFailures(
    watch.page,
    watch.watched,
    testInfo,
    ownDocumentLine(watch.documentFailures),
  );
  const requestLines = watch.failedRequests.filter((line) => origin === null || line.includes(origin));
  return [...consoleLines, ...requestLines].filter(unexpected);
}

export const test = base.extend<{ quiet: undefined }>({
  quiet: [
    async ({ context, baseURL }, use, testInfo) => {
      const watches = context.pages().map(watchPage);
      context.on("page", (page) => watches.push(watchPage(page)));
      await use(undefined);
      const origin = baseURL === undefined ? null : new URL(baseURL).origin;
      for (const watch of watches) {
        const lines = await failuresOf(watch, testInfo, origin);
        expect.soft(lines, `${testInfo.project.name}: console errors and failed requests`).toEqual([]);
      }
    },
    { auto: true },
  ],
});

export { expect };
