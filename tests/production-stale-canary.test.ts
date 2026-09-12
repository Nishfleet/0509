import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("Production stale canary workflow", () => {
  const workflow = readFileSync(".github/workflows/production-stale-canary.yml", "utf8");
  const parsed = parse(workflow) as {
    on: {
      workflow_dispatch?: unknown;
      schedule?: Array<{ cron?: string }>;
    };
    permissions?: Record<string, string>;
    concurrency?: { group?: string; "cancel-in-progress"?: boolean };
    jobs: {
      detect?: {
        name?: string;
        "runs-on"?: string;
        "timeout-minutes"?: number;
        steps?: Array<{
          id?: string;
          name?: string;
          if?: string;
          run?: string;
          env?: Record<string, string>;
          uses?: string;
          with?: Record<string, unknown>;
        }>;
      };
    };
  };

  // Issue #3224: deploy staleness must surface as a detector, not a
  // discarded observation. The deploy workflow itself runs
  // scripts/check-live-public-home.mjs as its `live_public_truth`
  // post-deploy step, but that only emits a verdict WHILE a deploy run
  // is executing — a deploy chain that has been red for hours, with every
  // run failing source_backup_migration_ledger_stale, sits in silence.
  // This workflow is the in-tree detector that runs on a fixed cadence
  // so the staleness surface cannot sit quiet for longer than 30
  // minutes. These pins keep that contract honest: 30-minute cadence,
  // workflow_dispatch for hand-launch, contents-only permission, the
  // canonical check-live-public-home.mjs probe URL.

  it("runs on a fixed cadence that catches a red deploy chain within 30 minutes", () => {
    expect(parsed.on.schedule).toEqual([{ cron: "*/30 * * * *" }]);
    expect(parsed.on.workflow_dispatch).toBeDefined();
    expect(parsed.permissions).toEqual({ contents: "read" });
    expect(parsed.concurrency).toEqual({
      group: "production-stale-canary",
      "cancel-in-progress": false,
    });
    const job = parsed.jobs.detect;
    expect(job?.name).toBe("Detect production staleness");
    expect(job?.["runs-on"]).toBe("ubuntu-latest");
    // 5 minutes is the bound: scripts/check-live-public-home.mjs already
    // has a 60-second worst-case retry budget (12 attempts × 5s) inside
    // its run() loop, so this is generous without wasting runner time on
    // a hung deploy.
    expect(job?.["timeout-minutes"]).toBe(5);
    const probe = job?.steps?.find((step) => step.id === "probe");
    expect(probe?.env?.PUBLIC_HOME_URL).toBe("https://0509.io");
    expect(probe?.run).toContain("node scripts/check-live-public-home.mjs");
  });

  // scripts/check-live-public-home.mjs bundles every probe a stale
  // build regresses: required marketing signals, forbidden CSP tokens,
  // Cloudflare Web Analytics beacon host, Google Fonts hosts, the
  // public-HTML cache-control contract, second-request
  // x-0509-edge-cache: HIT, and nonce-free script-src on both anonymous
  // probes. The detector must call the script — not duplicate any of
  // its checks here — so the canary and the deploy workflow's
  // live_public_truth step can never silently diverge.

  it("calls the canonical check-live-public-home.mjs detector and uses its exit code as the verdict", () => {
    const job = parsed.jobs.detect;
    const probe = job?.steps?.find((step) => step.id === "probe");
    const probeRun = probe?.run ?? "";
    expect(probeRun).toContain("node scripts/check-live-public-home.mjs");
    // The script's non-zero exit must FAIL the workflow — exit 1 from the
    // script means production is stale (missed one of its checks). The
    // fail-loud rule: a detector that cannot prove a verdict must NOT
    // silently degrade to green; this is the same rule the
    // meta-discovery canary enforces (2026-08-24 incident).
    expect(probeRun).toMatch(/process\.exit\(1\)|exit 1/);
    // No toleration semantics — `set -e` would exit the shell on the
    // first non-zero; `set -uo pipefail` (without -e) only fails on
    // unbound variables and broken pipes, leaving the script exit code
    // in scope so we can branch on it.
    expect(probeRun).toMatch(/set -uo pipefail|set -[a-z]*[a-z]/);
  });

  // The probe only writes its state when it reaches a verdict. Any
  // other failure path (network down, script crash, the temporary
  // probe_log already cleaned up) exits the step before writing state,
  // and the persisted artifact for that run is red. Without these
  // pins, a 2026-08-24-style silent skip would reappear: green-checked
  // canary with no recorded verdict.

  it("fails loudly when it cannot produce a verdict, never skips as success", () => {
    const job = parsed.jobs.detect;
    const probeRun = job?.steps?.find((step) => step.id === "probe")?.run ?? "";
    expect(probeRun).toContain("state=red");
    expect(probeRun).toContain("state=green");
    // The green marker may only be reached after the script exits 0;
    // the red marker is the only branch the script's non-zero exit
    // reaches.
    expect(probeRun.match(/state=green/g)).toHaveLength(1);
    expect(probeRun.match(/state=red/g)).toHaveLength(1);

    const persist = job?.steps?.find((step) => step.name === "Persist canary state evidence");
    const upload = job?.steps?.find((step) => step.name === "Upload canary state evidence");
    // Red runs must still publish their state artifact so the published
    // history shows red rather than an absent record.
    expect(persist?.if).toContain("always()");
    expect(upload?.if).toContain("always()");
    expect(persist?.env?.STATE).toBe("${{ steps.probe.outputs.state || 'red' }}");
    expect(upload?.with?.["if-no-files-found"]).toBe("error");
  });

  // The detector is read-only. It must NOT request any privileged
  // environment or write to issues — that is the red-on-main-watch
  // workflow's job, and pulling them into one place would let a
  // canary failure accidentally mutate the issue tracker. The deploy
  // workflow's own `live_public_truth` step is also a probe with no
  // privileges, and coupling those two as the same surface is the
  // point of this canary.

  it("is read-only — no production environment, no issue writes, no provider secrets", () => {
    const job = parsed.jobs.detect;
    expect(job?.environment, "canary environment").toBeUndefined();
    const probe = job?.steps?.find((step) => step.id === "probe");
    const persist = job?.steps?.find((step) => step.name === "Persist canary state evidence");
    const probeAndPersist = [probe?.env ?? {}, persist?.env ?? {}];
    const allEnv = Object.assign({}, ...probeAndPersist);
    for (const [key, value] of Object.entries(allEnv)) {
      expect(value, `step env ${key}`).not.toMatch(/secrets\./);
    }
    const upload = job?.steps?.find((step) => step.name === "Upload canary state evidence");
    expect(upload?.uses).toMatch(/@/);
    // All action references must be SHA-pinned. workflow-routing-hardening
    // enforces this for every workflow file, but a worker reading just
    // this file can also see it locally.
    const fullSha = /@[a-f0-9]{40}/;
    expect(probe, "probe step").toBeTruthy();
    expect(persist, "persist step").toBeTruthy();
    expect(upload?.uses, "upload action SHA pin").toMatch(fullSha);
  });
});
