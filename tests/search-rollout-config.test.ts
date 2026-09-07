import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  resolveSearchRolloutMode,
  shouldApplySearchV2,
  shouldRunSearchV2Shadow,
} from "../app/lib/search-rollout.server";

/**
 * Committed-configuration guard for the public search rollout.
 *
 * History this exists to prevent: `SEARCH_ROLLOUT_MODE` sat at `"shadow"` in
 * `wrangler.jsonc` from 2026-07-14 to 2026-08-12. In shadow the v2 pipeline
 * ran on every website-scoped public search, classified every candidate, and
 * then threw the verified set away — visitors kept receiving the unfiltered
 * legacy provider list (a nykaa.com search served 13 other brands' ads with no
 * label). Nothing in `npm test` noticed for 29 days, because the only rollout
 * assertions lived in post-deploy checks (`.github/workflows/uptime-health.yml`)
 * and in `scripts/customer-readiness-candidate.mjs`, which no workflow runs.
 *
 * These assertions read the committed configuration, so a change that puts
 * public search back into shadow (or legacy) fails before merge instead of
 * after a deploy.
 */
function readWranglerVars(path: string): Record<string, unknown> {
  const raw = readFileSync(path, "utf8");
  // wrangler.jsonc allows // comments; strip them before parsing. String
  // contents are preserved by only dropping comments that start a run of
  // non-quoted text on their line.
  const withoutComments = raw
    .split("\n")
    .map((line) => {
      const commentIndex = line.indexOf("//");
      if (commentIndex === -1) return line;
      const before = line.slice(0, commentIndex);
      const quoteCount = (before.match(/"/g) ?? []).length;
      return quoteCount % 2 === 0 ? before : line;
    })
    .join("\n");
  const parsed = JSON.parse(withoutComments) as { vars?: Record<string, unknown> };
  return parsed.vars ?? {};
}

describe("public search rollout configuration", () => {
  it("keeps the deployed Worker on the v2 rollout, never shadow or legacy", () => {
    const vars = readWranglerVars("wrangler.jsonc");

    expect(vars.SEARCH_ROLLOUT_MODE).toBe("v2");
  });

  it("keeps the local release-proof Worker on the same rollout as production", () => {
    const productionVars = readWranglerVars("wrangler.jsonc");
    const e2eVars = readWranglerVars("wrangler.e2e.jsonc");

    expect(e2eVars.SEARCH_ROLLOUT_MODE).toBe(productionVars.SEARCH_ROLLOUT_MODE);
  });

  it("applies the verified-advertiser filter for the committed production mode", () => {
    const vars = readWranglerVars("wrangler.jsonc");
    const env = { SEARCH_ROLLOUT_MODE: String(vars.SEARCH_ROLLOUT_MODE) };

    expect(resolveSearchRolloutMode(env)).toBe("v2");
    // Customer-visible consequence of the committed flag: the post-filter is
    // applied to the response, and the discard-the-result shadow path is off.
    expect(shouldApplySearchV2(env)).toBe(true);
    expect(shouldRunSearchV2Shadow(env)).toBe(false);
  });

  it("still treats shadow as a comparison-only mode that hides the filter", () => {
    // Documents why the committed value matters: shadow computes the verified
    // set and does not serve it. Kept as an executable statement of the
    // failure mode the first assertion guards against.
    expect(shouldApplySearchV2({ SEARCH_ROLLOUT_MODE: "shadow" })).toBe(false);
    expect(shouldRunSearchV2Shadow({ SEARCH_ROLLOUT_MODE: "shadow" })).toBe(true);
    expect(shouldApplySearchV2({ SEARCH_ROLLOUT_MODE: "legacy" })).toBe(false);
    expect(shouldRunSearchV2Shadow({ SEARCH_ROLLOUT_MODE: "legacy" })).toBe(false);
    // An unset or unrecognised value falls back to legacy, which also hides
    // the filter — so an accidental deletion of the var fails the first test.
    expect(shouldApplySearchV2({ SEARCH_ROLLOUT_MODE: undefined })).toBe(false);
  });
});
