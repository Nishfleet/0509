import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("uptime health ownership", () => {
  // Issue #3068 / docs/ci-gates-ledger.md (issue #2994): the 5-minute Actions
  // cron was never real liveness (median 63 minutes between runs over 300
  // observations, 2026-07-25..2026-08-11) and each scheduled run queued behind
  // CI on the three-runner FIFO. Production liveness detection is the
  // 0509-liveness systemd timer on the VPS (ops/liveness/), which fires on the
  // exact five-minute cadence outside Actions. The dispatch-only workflow file
  // was deleted as dead weight; reintroducing a scheduled uptime workflow would
  // re-add the cadence lie while the systemd probe still owns detection.
  it("keeps uptime-health.yml deleted — the 0509-liveness systemd timer is the detector", () => {
    expect(existsSync(".github/workflows/uptime-health.yml")).toBe(false);
    expect(existsSync("ops/liveness/0509-liveness.timer")).toBe(true);
    expect(existsSync("ops/liveness/0509-liveness.service")).toBe(true);
    expect(existsSync("ops/liveness/provision-production-liveness.sh")).toBe(
      true,
    );
    const timer = readFileSync("ops/liveness/0509-liveness.timer", "utf8");
    expect(timer).toContain("OnCalendar=*:2/5");
    expect(readFileSync("docs/ci-gates-ledger.md", "utf8")).toContain(
      "uptime-health.yml",
    );
  });
});
