import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// WP-C2 §0/§8 — the Wire register is atmosphere, not renaming. These files
// carry every customer-facing first-run string; guard them against the banned
// cop-show/surveillance vocabulary and against SF-1 naming drift.
const FILES = [
  "../app/components/first-run-spine.tsx",
  "../app/components/first-run-wire.tsx",
  "../app/components/first-run-wait.tsx",
  "../app/routes/app.dashboard.tsx",
  "../app/routes/app.watchlists.tsx",
  // BL-007: the opened competitor's customer copy moved into its own
  // component; the banned-vocabulary guard follows the copy.
  "../app/components/watchlists/competitor-detail.tsx",
  "../app/routes/app.digests.tsx",
].map((relative) => fileURLToPath(new URL(relative, import.meta.url)));

const sources = FILES.map((path) => ({ path, text: readFileSync(path, "utf8") }));

// Case-insensitive banned phrases (surveillance/cop-show register).
const BANNED_CI = [
  "stakeout",
  "staking out",
  "under watch",
  "on camera",
  "caught in the act",
  "surveillance",
  "target acquired",
  "case file",
  "case #",
];

describe("first-run wire — banned surveillance vocabulary", () => {
  it.each(BANNED_CI)("never uses %p in first-run source", (phrase) => {
    for (const { path, text } of sources) {
      expect(
        text.toLowerCase().includes(phrase),
        `${phrase} found in ${path}`,
      ).toBe(false);
    }
  });

  it("never uses a standalone all-caps REC (recording) mark", () => {
    for (const { path, text } of sources) {
      expect(/\bREC\b/.test(text), `REC found in ${path}`).toBe(false);
    }
  });
});

describe("first-run wire — naming spine is 'brief', never 'edition'", () => {
  it("keeps the deliverable/CTA noun as 'brief'", () => {
    const digests = sources.find((s) => s.path.endsWith("app.digests.tsx"))!;
    expect(digests.text).toContain("Read the full brief →");
    expect(digests.text).not.toContain("Read the full edition");
  });

  it("never introduces 'edition' as a noun anywhere in the first-run arc", () => {
    for (const { path, text } of sources) {
      expect(/edition/i.test(text), `edition found in ${path}`).toBe(false);
    }
  });
});
