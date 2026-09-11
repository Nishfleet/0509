import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The tests/ file-size ratchet (issue #2376).
 *
 * CLAUDE.md sets "200-400 lines typical, 800 max" for files, and the suite
 * already ships a split ceiling for the watchlists route tests
 * (`tests/helpers/watchlists-route-file-size.ts`). The ceiling was never
 * enforced across `tests/` itself, so 64 test files sit above it today:
 * `ad-source.test.ts` is 6.6k lines, `data.server.test.ts` 5.1k,
 * `delivery.server.test.ts` 4.2k. A test file that big is where duplicated
 * setup and hidden coupling live, and where one describe block stops being
 * reviewable.
 *
 * The rule is one line: every test file over 800 lines must be a file this
 * ratchet already knows about. `SEEDED_OVER_800_TEST_FILES` is that list,
 * seeded on 2026-09-10 with the 64 files that were over 800 lines on `main`.
 *
 * That single rule gives both directions:
 *
 * - A new test file over 800 lines is not in the list, so CI fails.
 * - A split moves the file off the list and passes CI without editing this
 *   file -- unless the split leaves a NEW file over 800, which is real debt
 *   and fails. Delete the now-small entry from the list when you split, and
 *   the allowance shrinks with it.
 *
 * A subset check rather than a bare count, because a count cannot see a swap:
 * split one oversized file and land a new one and the number is unchanged.
 *
 * Nothing in this file can see a seed entry being ADDED, and no test can: the
 * list is the allowance, so a hand-raised ceiling is a one-line diff, not a
 * runtime state. That diff is the reviewed act. The mechanical backstop is
 * `.github/scripts/gate-integrity.sh`, which already fails a raised ceiling
 * for `docs/design-system-ratchet.json`; registering this file there is
 * outside #2376's `files:` and `do:` and is filed as a follow-up.
 */
export const TEST_FILE_MAX_LINES = 800;

/**
 * Every test file over `TEST_FILE_MAX_LINES` when the ratchet landed, sorted.
 * The list is the allowance: it only ever shrinks.
 */
export const SEEDED_OVER_800_TEST_FILES = [
  "tests/ad-source.test.ts",
  "tests/ads-brand-page.render.test.tsx",
  "tests/ads-brand-page.route.test.ts",
  "tests/agent-actions.server.test.ts",
  "tests/api-v1.route.test.ts",
  "tests/auth.server.test.ts",
  "tests/bet2-live-verification.test.ts",
  "tests/bet3-live-verification.test.ts",
  "tests/billing-page.route.test.ts",
  "tests/clients.route.test.ts",
  "tests/competitor-site-content.test.ts",
  "tests/competitor-site-monitor.server.test.ts",
  "tests/competitor-site-monitoring-migration.test.ts",
  "tests/creative-text.test.ts",
  "tests/cron-failure-alert.server.test.ts",
  "tests/customer-agent-actions.server.test.ts",
  "tests/customer-agent-atomicity.test.ts",
  "tests/d1-remote-restore-evidence.test.ts",
  "tests/dashboard-activation.route.test.ts",
  "tests/dashboard.route.test.ts",
  "tests/data.server.test.ts",
  "tests/delivery-attempt-retry-claim.test.ts",
  "tests/delivery.server.test.ts",
  "tests/deploy-production-gate.test.ts",
  "tests/digest-email.test.ts",
  "tests/dodo-billing-guard.route.test.ts",
  "tests/dodo-billing-reversal-atomicity.test.ts",
  "tests/dodo-billing.server.test.ts",
  "tests/dodo-checkout.route.test.ts",
  "tests/dodo-pricing-checkout-validation.server.test.ts",
  "tests/dodo-pricing.server.test.ts",
  "tests/dodo-webhook.route.test.ts",
  "tests/evidence-usage.test.ts",
  "tests/funnel-measurement.test.ts",
  "tests/gate-c-soak.test.ts",
  "tests/landing-page-signals.test.ts",
  "tests/landing-pages.browser-run.test.ts",
  "tests/launch-readiness-guard.route.test.ts",
  "tests/mcp.route.test.ts",
  "tests/meta-library-browser.test.ts",
  "tests/monitoring-evidence-lifecycle.test.ts",
  "tests/monitoring-fanout.test.ts",
  "tests/monitoring-reliability.test.ts",
  "tests/monitoring-scheduled-runtime.test.ts",
  "tests/onboarding.route.test.ts",
  "tests/operator-delivery-reconciliation.test.ts",
  "tests/ops.route.test.ts",
  "tests/plan-limits.route.test.ts",
  "tests/plan-monitoring.test.ts",
  "tests/playwright-release-manifest-reporter.test.ts",
  "tests/presence.route.test.ts",
  "tests/provider-bakeoff.test.ts",
  "tests/search-answer.test.ts",
  "tests/search-submission-settle.test.tsx",
  "tests/search.route.test.ts",
  "tests/share-links.test.ts",
  "tests/share-pdf-variant.test.ts",
  "tests/sitemap.server.test.ts",
  "tests/support.route.test.ts",
  "tests/verify-post-deploy-release.test.ts",
  "tests/watch-event-evaluator.test.ts",
  "tests/watchlists.route.actions.test.ts",
  "tests/watchlists.route.test.ts",
  "tests/workspace-cleanup.test.ts",
] as const;

export interface TestFileSize {
  relativePath: string;
  lineCount: number;
}

/**
 * A test file under `tests/` -- the suite, not its helpers, fixtures or
 * snapshots, and not a test that lives outside `tests/`.
 */
export function isTestFile(relativePath: string): boolean {
  return relativePath.startsWith("tests/") && /\.test\.tsx?$/.test(relativePath);
}

export function findOversizedTestFiles(
  files: readonly TestFileSize[],
  maxLines = TEST_FILE_MAX_LINES,
): TestFileSize[] {
  return files.filter(
    (file) => isTestFile(file.relativePath) && file.lineCount > maxLines,
  );
}

/**
 * Oversized test files the seed list does not already carry: the debt this
 * ratchet exists to reject. Splits that stay under the ceiling leave this
 * empty without editing the seed list.
 */
export function findUnseededOversizedTestFiles(
  files: readonly TestFileSize[],
  seeded: readonly string[] = SEEDED_OVER_800_TEST_FILES,
  maxLines = TEST_FILE_MAX_LINES,
): TestFileSize[] {
  const allowed = new Set(seeded);
  return findOversizedTestFiles(files, maxLines).filter(
    (file) => !allowed.has(file.relativePath),
  );
}

/** Recursive: the oversized files are not all at the top level of `tests/`. */
export function listTestFileSizes(root: string): TestFileSize[] {
  const files: TestFileSize[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const absolute = join(directory, entry);
      if (statSync(absolute).isDirectory()) {
        walk(absolute);
        continue;
      }
      const relativePath = relative(root, absolute).replaceAll("\\", "/");
      if (!isTestFile(relativePath)) {
        continue;
      }
      files.push({
        relativePath,
        // The same counting method as the read-only precedent
        // `tests/helpers/watchlists-route-file-size.ts`, so the two ratchets
        // agree on what one line is.
        lineCount: readFileSync(absolute, "utf8").split("\n").length,
      });
    }
  };
  walk(join(root, "tests"));
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

const root = join(__dirname, "..");
const sizes = listTestFileSizes(root);

function describeSize(file: TestFileSize): string {
  return `${file.relativePath} (${file.lineCount} lines)`;
}

describe("tests/ file-size ratchet", () => {
  it("no test file over 800 lines that the seed list does not already carry", () => {
    // `> 800`, not `>= 800`: "800 max" means 800 is allowed. Failures name the
    // files and their sizes, so the author knows what to split, not only how
    // many.
    const unseeded = findUnseededOversizedTestFiles(sizes);
    expect(
      unseeded.map(describeSize),
      `over ${TEST_FILE_MAX_LINES} lines and not in SEEDED_OVER_800_TEST_FILES`,
    ).toEqual([]);
  });

  it("the scan is not vacuous -- every seeded path comes back from a live walk", () => {
    // The failure mode of a ratchet is a scan that quietly finds nothing: no
    // oversized file, no violation, green forever. Every seeded path must be
    // found, and the walk must see far more files than the seed carries.
    const scanned = new Set(sizes.map((file) => file.relativePath));
    for (const seeded of SEEDED_OVER_800_TEST_FILES) {
      expect(scanned.has(seeded), `${seeded} was not found under tests/`).toBe(true);
    }
    expect(sizes.length).toBeGreaterThan(SEEDED_OVER_800_TEST_FILES.length);
    expect(SEEDED_OVER_800_TEST_FILES.length).toBe(new Set(SEEDED_OVER_800_TEST_FILES).size);
  });

  it("every seed entry is still a real file -- a rename prunes its own entry", () => {
    // A stale entry (split landed, list not pruned) is allowed and does not
    // fail CI. A missing file is not: the entry would linger forever naming a
    // path no one can split, so the rename must prune it.
    const known = new Set(sizes.map((file) => file.relativePath));
    for (const seeded of SEEDED_OVER_800_TEST_FILES) {
      expect(
        known.has(seeded),
        `${seeded} was renamed or deleted -- prune it from the seed list`,
      ).toBe(true);
    }
  });
});

describe("the ratchet has teeth", () => {
  it("801 lines is oversized, 800 is not", () => {
    expect(
      findOversizedTestFiles([{ relativePath: "tests/a.test.ts", lineCount: 800 }]),
    ).toEqual([]);
    expect(
      findOversizedTestFiles([{ relativePath: "tests/a.test.ts", lineCount: 801 }]),
    ).toEqual([{ relativePath: "tests/a.test.ts", lineCount: 801 }]);
  });

  it("counts test files only -- helpers, snapshots and non-tests are out of scope", () => {
    const files: TestFileSize[] = [
      { relativePath: "tests/a.test.ts", lineCount: 900 },
      { relativePath: "tests/b.test.tsx", lineCount: 900 },
      { relativePath: "tests/helpers/thing.ts", lineCount: 900 },
      { relativePath: "tests/__snapshots__/a.test.ts.snap", lineCount: 9_000 },
      { relativePath: "scripts/thing.test.ts", lineCount: 900 },
    ];
    expect(findOversizedTestFiles(files).map((file) => file.relativePath)).toEqual([
      "tests/a.test.ts",
      "tests/b.test.tsx",
    ]);
    expect(isTestFile("tests/helpers/sqlite-d1.test.ts")).toBe(true);
    expect(isTestFile("tests/helpers/sqlite-d1.ts")).toBe(false);
    expect(isTestFile("scripts/thing.test.ts")).toBe(false);
  });

  it("a new over-800 test file fails the ratchet -- the acceptance case", () => {
    // The real scan plus one synthetic new file, exactly as a PR adding
    // `tests/something-huge.test.ts` would look to this gate.
    const withNewFile = [
      ...sizes,
      { relativePath: "tests/something-huge.test.ts", lineCount: 4_000 },
    ];
    expect(findUnseededOversizedTestFiles(sizes)).toEqual([]);
    expect(findUnseededOversizedTestFiles(withNewFile).map((file) => file.relativePath)).toEqual(
      ["tests/something-huge.test.ts"],
    );
  });

  it("a swap fails -- a split cannot buy room for a new oversized name", () => {
    // The hole a bare count leaves: split `ad-source` and land a new oversized
    // file, and the number of over-800 files is unchanged. The name check
    // still catches it.
    const withoutOne = sizes.filter(
      (file) => file.relativePath !== "tests/ad-source.test.ts",
    );
    const swapped = [
      ...withoutOne,
      { relativePath: "tests/ad-source-actions.test.ts", lineCount: 3_300 },
    ];
    expect(findOversizedTestFiles(withoutOne).length).toBe(
      findOversizedTestFiles(sizes).length - 1,
    );
    expect(findUnseededOversizedTestFiles(swapped).map((file) => file.relativePath)).toEqual([
      "tests/ad-source-actions.test.ts",
    ]);
  });

  it("a split that lands under 800 passes without editing this file", () => {
    // The downward path. `ad-source.test.ts` shrinks under the ceiling and
    // nothing new crosses it, so the seed entry is stale and the ratchet is
    // still green -- no edit, no merge-queue conflict with a sibling split.
    const split = sizes.map((file) =>
      file.relativePath === "tests/ad-source.test.ts" ? { ...file, lineCount: 640 } : file,
    );
    expect(findUnseededOversizedTestFiles(split)).toEqual([]);
  });

  it("the ratchet can see itself, and this file is not over the ceiling", () => {
    const own = sizes.find(
      (file) => file.relativePath === "tests/file-size-ratchet.test.ts",
    );
    expect(own, "the ratchet must be able to see itself").toBeDefined();
    expect(own?.lineCount ?? 0).toBeLessThanOrEqual(TEST_FILE_MAX_LINES);
  });
});
