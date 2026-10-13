import { expect, test as base, type TestInfo } from "@playwright/test";

import { consoleFailures, type ConsoleEntry, watchConsole, watchRequests } from "./inbox";

function ownDocumentLine(failures: ReadonlyMap<string, number>): (entry: ConsoleEntry) => boolean {
  return (entry) => {
    const status = failures.get(entry.url);
    return status !== undefined && entry.text.includes(`status of ${String(status)}`);
  };
}

export function expectNoise(pattern: RegExp): void {
  base.info().annotations.push({ type: "quiet-exception", description: pattern.source });
}

export const test = base.extend<{ quiet: undefined }, object>({
  quiet: [
    async ({ page }, use, testInfo: TestInfo) => {
      const watched = watchConsole(page);
      const failedRequests = watchRequests(page);
      const documentFailures = new Map<string, number>();
      page.on("response", (response) => {
        if (response.status() >= 400 && response.request().resourceType() === "document") {
          documentFailures.set(response.url(), response.status());
        }
      });
      await use(undefined);
      const allowed = testInfo.annotations
        .filter((annotation) => annotation.type === "quiet-exception")
        .map((annotation) => new RegExp(annotation.description ?? "(?!)"));
      const unexpected = (line: string) => !allowed.some((pattern) => pattern.test(line));
      const origin = page.url().startsWith("http") ? new URL(page.url()).origin : "";
      const consoleLines = (await consoleFailures(page, watched, testInfo, ownDocumentLine(documentFailures))).filter(
        unexpected,
      );
      const requestLines = failedRequests.filter((line) => line.includes(origin) && unexpected(line));
      expect.soft(consoleLines, `${testInfo.project.name}: console errors`).toEqual([]);
      expect.soft(requestLines, `${testInfo.project.name}: failed requests`).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
