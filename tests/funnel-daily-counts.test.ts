import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

const SCRIPT = path.resolve(__dirname, "..", "scripts", "funnel-daily-counts.mjs");

function run(lines: string[]) {
  const result = spawnSync(process.execPath, [SCRIPT], {
    input: lines.join("\n"),
    encoding: "utf8",
  });
  expect(result.status).toBe(0);
  return { stdout: result.stdout, stderr: result.stderr };
}

describe("scripts/funnel-daily-counts.mjs", () => {
  it("counts the original allowlisted operations", () => {
    const { stdout } = run([
      JSON.stringify({
        timestamp: "2026-09-10T00:00:00.000Z",
        operation: "funnel_home_view",
        details: { event_id: "e1", route: "/" },
      }),
    ]);
    expect(stdout).toContain("2026-09-10 funnel_home_view 1");
  });

  it("counts funnel_migration_view instead of bucketing it as non-funnel (M62 repro)", () => {
    const { stdout, stderr } = run([
      JSON.stringify({
        timestamp: "2026-09-10T00:00:00.000Z",
        operation: "funnel_migration_view",
        details: { event_id: "e1", route: "/compare/magicbrief" },
      }),
    ]);
    expect(stdout).toContain("2026-09-10 funnel_migration_view 1");
    expect(stderr).not.toContain("non-funnel");
  });

  it("counts the other spec'd funnel operations (magicbrief signup start, signup completed, first brief)", () => {
    const { stdout, stderr } = run([
      JSON.stringify({
        timestamp: "2026-09-10T01:00:00.000Z",
        operation: "funnel_signup_start_magicbrief",
        details: { event_id: "e2", route: "/magicbrief" },
      }),
      JSON.stringify({
        timestamp: "2026-09-10T02:00:00.000Z",
        operation: "funnel_signup_start_locale_ja",
        details: { event_id: "e3", route: "/ja/sneaker-resale" },
      }),
      JSON.stringify({
        timestamp: "2026-09-10T03:00:00.000Z",
        operation: "funnel_signup_completed",
        details: { event_id: "e4", route: "/signup" },
      }),
      JSON.stringify({
        timestamp: "2026-09-10T04:00:00.000Z",
        operation: "funnel_first_brief_generated",
        details: { event_id: "e5", route: "/app" },
      }),
      JSON.stringify({
        timestamp: "2026-09-10T05:00:00.000Z",
        operation: "funnel_activation_scan_started",
        details: { event_id: "e6", route: "/app/scan" },
      }),
    ]);
    for (const op of [
      "funnel_signup_start_magicbrief",
      "funnel_signup_start_locale_ja",
      "funnel_signup_completed",
      "funnel_first_brief_generated",
      "funnel_activation_scan_started",
    ]) {
      expect(stdout).toContain(`2026-09-10 ${op} 1`);
    }
    expect(stderr).not.toContain("non-funnel");
  });

  it("still buckets genuinely non-funnel operations and unknown detail keys", () => {
    const { stdout, stderr } = run([
      JSON.stringify({
        timestamp: "2026-09-10T00:00:00.000Z",
        operation: "some_other_event",
        details: { event_id: "e1" },
      }),
      JSON.stringify({
        timestamp: "2026-09-10T01:00:00.000Z",
        operation: "funnel_home_view",
        details: { event_id: "e2", sneaky: "key" },
      }),
    ]);
    expect(stdout).not.toContain("some_other_event");
    expect(stderr).toContain("1 non-funnel record(s) skipped");
    expect(stderr).toContain("detail keys outside the field allowlist");
  });
});
