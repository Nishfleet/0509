import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Issue #2716 — the anonymous public-HTML edge cache added by #2388 became a
 * permanent no-op once #2348 turned on per-response CSP nonces: a cached
 * document carries the whole response, headers included, so a nonce-bearing
 * body would hand the same nonce to every visitor of a colo for the cache
 * TTL, and #2348 therefore refuses to store any nonce-bearing document —
 * which is every document this cache was built to serve.
 *
 * Route 2 of the issue's options was taken: the cache path was deleted rather
 * than kept as dead code. This test is the detector that the no-op machinery
 * stays out: any re-introduction of a document edge cache (or of the status
 * header it stamped) has to arrive with the nonce problem actually solved,
 * not as a silent no-op like the one this issue closed.
 */
describe("public HTML document edge cache is removed (issue #2716)", () => {
  const workerSource = readFileSync(new URL("../workers/app.ts", import.meta.url), "utf8");

  it("does not stamp the #2388 edge-cache status header", () => {
    expect(workerSource).not.toContain("x-0509-cache");
    expect(workerSource).not.toContain("EDGE_CACHE_STATUS_HEADER");
  });

  it("does not reintroduce the #2388 document cache helpers", () => {
    for (const symbol of [
      "isEdgeCacheableHtmlResponse",
      "storeEdgeCachedHtmlResponse",
      "readEdgeCachedResponse",
      "edgeCacheKeyForRequest",
      "EDGE_CACHE_TTL_SECONDS",
    ]) {
      expect(workerSource).not.toContain(symbol);
    }
  });
});
