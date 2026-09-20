import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * A live document may not cite a repository path that does not exist.
 *
 * This guard exists because the same defect kept surfacing all through the
 * 2026-09-17..20 glue sweeps, and every instance of it cost real time:
 *
 *   - CLAUDE.md told agents to unblock a protected-verifier PR by posting a
 *     `verifier-attest: <sha>` comment. That workflow had been deleted, so the
 *     ritual it described did nothing.
 *   - DESIGN.md said the design-system ratchet "fails CI". No PR check and no
 *     npm script CI runs ever invoked that script.
 *   - docs/ops-backup-uptime.md opened with `npm run backup:d1:r2` as "the
 *     owner-operated backup command" after that script was deleted.
 *   - AGENTS.md told lanes to write `.lane/reports/<branch>.md` and then said
 *     the whole tree had been retired.
 *
 * A doc that names a file is making a checkable claim. Checking it is cheap,
 * and the alternative is that the next reader trusts it.
 *
 * TWO THINGS THIS DELIBERATELY ALLOWS.
 *
 * Dated records. docs/plans/*, PROJECT-HISTORY.md and anything carrying a date
 * in its name or a `Last updated:` line are frozen accounts of a past state.
 * They cite files that existed then, and rewriting them would destroy the
 * record. They are skipped entirely.
 *
 * Supersession notes. A live doc may name a deleted file in order to say it is
 * deleted — "`scripts/foo.mjs` was deleted 2026-09-20, use X instead" is the
 * most useful sentence such a doc can carry, because it stops the next person
 * hunting for it. A citation is allowed when its own line, or the two lines
 * around it, carry deletion language.
 */

const LIVE_DOCS = [
  "CLAUDE.md",
  "AGENTS.md",
  "README.md",
  "DESIGN.md",
  "docs/ci-gates-ledger.md",
  "docs/ga-metrics.md",
  "docs/ops-backup-uptime.md",
  "docs/email-outbound-auth.md",
  "docs/BACKLOG.md",
  "docs/monitoring-fanout-rollout.md",
] as const;

// Paths that read as repo paths and are not: npm scopes, URLs, globs.
const CITATION = /(?:^|[\s`("[])((?:app|workers|scripts|tests|e2e|ops|automation|config|migrations|db|\.github)\/[A-Za-z0-9_.\-/]+\.[a-z]{2,5})/g;

const GONE = /\b(delet|remov|supersed|retir|replac|was|were|used to|no longer|dead|gone|previously|former|old)\w*\b/i;

function trackedFiles(): Set<string> {
  return new Set(
    execFileSync("git", ["ls-files"], { encoding: "utf8", maxBuffer: 1 << 28 })
      .split("\n")
      .filter(Boolean),
  );
}

describe("live docs cite real paths", () => {
  const tracked = trackedFiles();

  for (const doc of LIVE_DOCS) {
    it(`${doc} names no file that does not exist`, () => {
      const lines = readFileSync(doc, "utf8").split("\n");
      const offenders: string[] = [];

      lines.forEach((line, i) => {
        // A supersession note may name the file it is retiring.
        const context = lines.slice(Math.max(0, i - 2), i + 3).join(" ");
        if (GONE.test(context)) return;

        for (const m of line.matchAll(CITATION)) {
          const path = m[1];
          if (path.includes("*") || tracked.has(path)) continue;
          offenders.push(`${doc}:${i + 1} cites ${path}`);
        }
      });

      expect(
        offenders,
        `${doc} names files that do not exist. Either fix the path, or say the file is gone — ` +
          `a sentence naming a deleted file and saying so is allowed, and is more useful than silence.`,
      ).toEqual([]);
    });
  }
});
