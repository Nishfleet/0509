import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Split ceiling: a 3k-line route test spent ~2.8s transforming before the
 * first test on an idle VPS, then timed out under the 10s node `testTimeout`
 * once the full suite was on the machine. Keep each split file under this. */
export const WATCHLISTS_ROUTE_TEST_MAX_LINES = 1800;

const WATCHLISTS_ROUTE_TEST_NAME =
  /^watchlists\.route(?:\.(?:loader|actions))?\.test\.ts$/;

export function isWatchlistsRouteTestFile(relativePath: string): boolean {
  const name = relativePath.split("/").pop() ?? "";
  return relativePath.startsWith("tests/") && WATCHLISTS_ROUTE_TEST_NAME.test(name);
}

export function findOversizedWatchlistsRouteTests(
  files: Array<{ relativePath: string; lineCount: number }>,
  maxLines = WATCHLISTS_ROUTE_TEST_MAX_LINES,
): Array<{ relativePath: string; lineCount: number }> {
  return files.filter(
    (file) =>
      isWatchlistsRouteTestFile(file.relativePath) && file.lineCount > maxLines,
  );
}

export function listWatchlistsRouteTestFiles(root: string): Array<{
  relativePath: string;
  lineCount: number;
}> {
  const testsDir = join(root, "tests");
  const files: Array<{ relativePath: string; lineCount: number }> = [];
  for (const entry of readdirSync(testsDir)) {
    const absolute = join(testsDir, entry);
    if (!statSync(absolute).isFile()) {
      continue;
    }
    const relativePath = relative(root, absolute).replaceAll("\\", "/");
    if (!isWatchlistsRouteTestFile(relativePath)) {
      continue;
    }
    const lineCount = readFileSync(absolute, "utf8").split("\n").length;
    files.push({ relativePath, lineCount });
  }
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}
