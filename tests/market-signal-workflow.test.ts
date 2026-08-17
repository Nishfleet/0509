import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const workflowPath = ".github/workflows/market-signal-snapshot.yml";
const contractPath = "automation/HERMES_MARKET_SIGNAL.md";
const snapshotPath = "ops/market-signal/0509-market-signal.json";

const source = readFileSync(workflowPath, "utf8");
const contract = readFileSync(contractPath, "utf8");

type Step = {
  name?: string;
  run?: string;
  env?: Record<string, string>;
  uses?: string;
  with?: Record<string, unknown>;
};

const parsed = parse(source) as {
  on?: {
    workflow_dispatch?: unknown;
    schedule?: Array<{ cron?: string }>;
  };
  permissions?: Record<string, string>;
  jobs?: Record<string, {
    "runs-on"?: string;
    environment?: string | { name?: string };
    "timeout-minutes"?: number;
    if?: string;
    env?: Record<string, string>;
    steps?: Step[];
  }>;
};

describe("daily market-signal D1 snapshot workflow", () => {
  const job = parsed.jobs?.snapshot;
  if (!job) throw new Error("market-signal-snapshot.yml is missing the snapshot job");

  it("runs on a daily morning schedule and supports an immediate manual restore", () => {
    expect(parsed.on?.schedule).toEqual([{ cron: "7 0 * * *" }]);
    expect(parsed.on?.workflow_dispatch).toBeDefined();
  });

  it("grants the token the scopes the snapshot script needs", () => {
    // The script reads the issue list (gh api .../issues) and commits the
    // snapshot, so the token needs issues: read and contents: write. A bare
    // contents-only block 403s on the issues API: "Resource not accessible
    // by integration" (first three restored runs, 2026-08-12). pull-requests
    // write is needed because main's branch protection rejects direct pushes,
    // so the snapshot lands through a PR squash merge.
    expect(parsed.permissions).toEqual({ contents: "write", issues: "read", "pull-requests": "write" });
  });

  it("generates the snapshot with Cloudflare token secrets on the self-hosted production-environment job", () => {
    expect(job["runs-on"]).toEqual(["self-hosted", "linux", "x64", "vps-verify"]);
    expect(job.environment).toBe("production");
    expect(job["timeout-minutes"]).toBe(30);
    expect(job.if).toBe("github.ref == 'refs/heads/main'");
    const generate = job.steps?.find((step) => step.name === "Generate market-signal D1 snapshot");
    expect(generate?.env).toEqual({
      CLOUDFLARE_ACCOUNT_ID: "${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
      CLOUDFLARE_API_TOKEN: "${{ secrets.CLOUDFLARE_API_TOKEN }}",
      GH_TOKEN: "${{ github.token }}",
    });
  });

  it("keeps heavyweight commands inside the shared runner lane", () => {
    const commands = job.steps?.map((step) => step.run).filter((run): run is string => Boolean(run)) ?? [];
    for (const command of commands) {
      if (/\bnpm (?:ci|run)\b/u.test(command)) {
        expect(command, command).toContain("./scripts/deploy-window-lock.sh run --");
      }
    }
    expect(commands.join("\n")).toContain("./scripts/deploy-window-lock.sh run -- npm ci");
    expect(commands.join("\n")).toContain("./scripts/deploy-window-lock.sh run -- npm run signal:market");
  });

  it("writes the snapshot to the exact path the Hermes contract reads", () => {
    expect(job.env?.SNAPSHOT_PATH).toBe(snapshotPath);
    expect(source).toContain(`--output "$SNAPSHOT_PATH"`);
    expect(source).toContain(`git add -- "$SNAPSHOT_PATH"`);
    expect(contract).toContain(`ops/market-signal/0509-market-signal.json`);
  });

  it("lands the snapshot on protected main through a PR squash merge", () => {
    // main has strict required status checks and enforce_admins, so the direct
    // push the old workflow used was rejected with GH006 (seen on every run,
    // e.g. 2026-08-14T02:36Z). The landing step must open a PR and merge it.
    const commit = job.steps?.find((step) => step.name === "Commit snapshot to main")?.run ?? "";
    expect(commit).not.toContain("git push origin HEAD:main");
    expect(commit).toContain("gh pr create");
    expect(commit).toContain("gh pr merge");
    expect(commit).toContain("--squash");
    expect(commit).toContain("--delete-branch");
    expect(commit).toContain("market_signal_snapshot_merged");
  });

  it("waits for required checks before merging instead of racing them", () => {
    // Merging immediately after gh pr create races the required checks
    // (codex-node-checks ~5-9 min, Gitleaks, required-verifier-integrity) and
    // fails every run with "required status check is expected", so the
    // snapshot never lands (all five restored runs died on the push/merge).
    // The landing step must arm auto-merge, watch the required checks, and
    // confirm the merge actually happened.
    const commit = job.steps?.find((step) => step.name === "Commit snapshot to main")?.run ?? "";
    expect(commit).toContain("--auto");
    expect(commit).toContain("gh pr checks");
    expect(commit).toContain("--watch");
    expect(commit).toContain("--required");
    expect(commit).toContain("market_signal_snapshot_checks_failed");
    expect(commit).toContain("market_signal_snapshot_merge_timeout");
    // The watch is bounded so a stuck check fails loudly instead of burning
    // the whole 30-minute job cap.
    expect(commit).toContain("timeout");
  });

  it("reuses a per-day automation branch so retries merge a single PR", () => {
    // The previous shape used a per-second branch suffix, so each rerun opened
    // a new PR with its own race and never resolved the stuck auto-merge. One
    // PR per day lets every retry on the same day land on the same head so
    // arm-auto-merge keeps firing on the same required checks rather than
    // racing 30+ stale PRs in parallel.
    const commit = job.steps?.find((step) => step.name === "Commit snapshot to main")?.run ?? "";
    expect(commit).toContain("automation/market-signal-snapshot-$(date -u +%Y%m%d)");
    expect(commit).not.toContain("+%H%M%S");
    expect(commit).toContain("gh pr list");
    expect(commit).toContain("market_signal_snapshot_existing_pr");
  });

  it("uses --force-if-includes so a fresh automation branch lands its first push", () => {
    // --force-with-lease fails on a brand-new branch (no upstream to lease
    // against), which is the failure mode that left the snapshot file off
    // main for every restored run. --force-if-includes is the documented
    // safe alternative for first push; the explicit --force fallback is the
    // last-resort path so the workflow degrades loudly instead of silently
    // never landing.
    const commit = job.steps?.find((step) => step.name === "Commit snapshot to main")?.run ?? "";
    expect(commit).toContain("--force-if-includes");
    expect(commit).toContain("git push --force origin");
  });

  it("rejects stale snapshots before committing them", () => {
    const freshness = job.steps?.find((step) => step.name === "Verify snapshot freshness")?.run ?? "";
    expect(freshness).toContain("generatedAt");
    expect(freshness).toContain("market_signal_snapshot_stale");
    expect(freshness).toContain("process.exit(1)");
  });

  it("tells Hermes to fail honestly when the daily snapshot is not fresh", () => {
    expect(contract).toContain("generatedAt");
    expect(contract).toContain("26 hours");
    expect(contract).toContain("Unavailable sources");
    expect(contract).toContain("do not present stale counts as current");
    expect(contract).toContain("Do not run `wrangler` on this host");
  });
});
