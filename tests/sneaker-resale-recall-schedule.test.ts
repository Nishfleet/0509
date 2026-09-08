import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Sneaker-resale recall canary scheduling rail", () => {
  // Issue #1945: the sneaker-resale cluster is the strongest, most-consistent
  // buyer signal across the daily market reports, but its 25 seed-list brands
  // had no recall guard at all — the existing search-tier-canary guards only
  // the §1.8 six-domain set and is not scheduled. The scheduling rail is a
  // systemd USER timer on the fleet VPS (the established rail for 0509
  // canaries, issues #1452 search-tier and #1899 demo-brand-timeline), NOT a
  // .github/workflows file — the worker GitHub App token cannot create or
  // update .github/workflows files (rejected push, #1899), so a workflow-based
  // schedule is not mergeable by a worker. This test pins the user timer rail
  // so a silent recall/alias regression on the strongest cluster self-files
  // every 3h rather than going unmeasured.

  it("schedules the recall canary every 3h as a systemd user timer", () => {
    const timer = readFileSync(
      "ops/sneaker-resale-recall-canary/0509-sneaker-resale-recall-canary.user.timer",
      "utf8",
    );
    expect(timer).toMatch(/OnCalendar=\*-\*-\* .+:00.Asia\/Kolkata/);
    // Every 3h (the issue's requested cadence on the scheduled-canary rails).
    expect(timer).toMatch(/\/3:00/);
    expect(timer).toMatch(/Unit=0509-sneaker-resale-recall-canary.service/);
    expect(timer).toMatch(/WantedBy=timers.target/);
  });

  it("runs the recall canary script from a self-syncing read-only checkout", () => {
    const service = readFileSync(
      "ops/sneaker-resale-recall-canary/0509-sneaker-resale-recall-canary.user.service",
      "utf8",
    );
    expect(service).toMatch(/ExecStart=\/usr\/bin\/env node scripts\/canary-sneaker-resale-recall.mjs --base-url https:\/\/0509.io/);
    // Self-syncs to main on every run via ExecStartPre; a dead-end or
    // blanket-unmatched coverage-bearing brand exits non-zero (stays failed).
    expect(service).toMatch(/ExecStartPre=\/usr\/bin\/env git -C .* fetch origin main/);
    expect(service).toMatch(/Restart=no/);
  });

  it("provides a reproducible installer on the help-first rail", () => {
    const installer = readFileSync(
      "ops/sneaker-resale-recall-canary/install-user-timer.sh",
      "utf8",
    );
    expect(installer).toMatch(/--help/);
    expect(installer).toMatch(/systemctl --user enable --now 0509-sneaker-resale-recall-canary.timer/);
  });
});
