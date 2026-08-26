import { describe, expect, it } from "vitest";

import {
  findOversizedWatchlistsRouteTests,
  listWatchlistsRouteTestFiles,
  WATCHLISTS_ROUTE_TEST_MAX_LINES,
} from "./helpers/watchlists-route-file-size";

const root = process.cwd();

describe("watchlists route test file size ratchet", () => {
  it("rejects a watchlists route test file over the split ceiling", () => {
    const oversized = findOversizedWatchlistsRouteTests([
      {
        relativePath: "tests/watchlists.route.test.ts",
        lineCount: WATCHLISTS_ROUTE_TEST_MAX_LINES + 1,
      },
      {
        relativePath: "tests/watchlists.route.actions.test.ts",
        lineCount: WATCHLISTS_ROUTE_TEST_MAX_LINES,
      },
      {
        relativePath: "tests/dodo-webhook.route.test.ts",
        lineCount: 10_000,
      },
    ]);

    expect(oversized).toEqual([
      {
        relativePath: "tests/watchlists.route.test.ts",
        lineCount: WATCHLISTS_ROUTE_TEST_MAX_LINES + 1,
      },
    ]);
  });

  it("keeps every live watchlists route test file under the split ceiling", () => {
    const files = listWatchlistsRouteTestFiles(root);
    expect(files.map((file) => file.relativePath)).toEqual([
      "tests/watchlists.route.actions.test.ts",
      "tests/watchlists.route.loader.test.ts",
      "tests/watchlists.route.test.ts",
    ]);
    expect(findOversizedWatchlistsRouteTests(files), JSON.stringify(files, null, 2)).toEqual(
      [],
    );
  });
});
