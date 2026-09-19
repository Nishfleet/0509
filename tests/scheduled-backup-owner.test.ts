import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

/**
 * Some workflow in the tree must own a SCHEDULE for the D1 backup.
 *
 * The bug this catches (#3679, found 2026-09-20): d1-backup-r2.yml dropped its
 * own `schedule` in #3576 and handed the cadence to
 * d1-restore-proof-auto-refresh.yml, writing "something else must own scheduled
 * backups" in its header. That workflow was later disabled, and the cadence went
 * with it — the repo was left with no scheduled D1 backup at all and nothing said
 * so. Ownership passed to a file, and the file went away.
 *
 * This asserts the property directly rather than naming a file, so the next
 * handoff is free to move it anywhere as long as a schedule survives the move.
 */

const WORKFLOW_DIR = ".github/workflows";

function workflows(): Array<{ name: string; source: string; parsed: unknown }> {
  return readdirSync(WORKFLOW_DIR)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map((name) => {
      const source = readFileSync(join(WORKFLOW_DIR, name), "utf8");
      return { name, source, parsed: parse(source) as unknown };
    });
}

function hasSchedule(parsed: unknown): boolean {
  const on = (parsed as { on?: unknown; true?: unknown })?.on ?? (parsed as { true?: unknown })?.true;
  if (!on || typeof on !== "object") return false;
  const schedule = (on as { schedule?: unknown }).schedule;
  return Array.isArray(schedule) && schedule.length > 0;
}

describe("scheduled D1 backup ownership (#3679)", () => {
  it("has at least one scheduled workflow that exports D1", () => {
    const owners = workflows().filter(
      (w) => hasSchedule(w.parsed) && /wrangler\s+d1\s+export/.test(w.source),
    );

    expect(
      owners.map((w) => w.name),
      "no scheduled workflow runs `wrangler d1 export` — the D1 backup has no owner",
    ).not.toHaveLength(0);
  });

  it("keeps the backup export off a workflow that only runs on dispatch", () => {
    for (const w of workflows()) {
      if (!/wrangler\s+d1\s+export/.test(w.source)) continue;
      const on = (w.parsed as { on?: Record<string, unknown> })?.on ?? {};
      const triggers = Object.keys(on);
      // A dispatch-only break-glass export is allowed to exist, but it must not
      // be the ONLY exporter — that is the state #3576 left the repo in.
      if (triggers.length === 1 && triggers[0] === "workflow_dispatch") {
        const others = workflows().filter(
          (o) => o.name !== w.name && hasSchedule(o.parsed) && /wrangler\s+d1\s+export/.test(o.source),
        );
        expect(
          others.map((o) => o.name),
          `${w.name} is dispatch-only and nothing else exports D1 on a schedule`,
        ).not.toHaveLength(0);
      }
    }
  });
});
