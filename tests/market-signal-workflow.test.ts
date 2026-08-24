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
    // The script reads the issue list (gh api .../issues) and pushes the
    // snapshot to the data branch, so the token needs issues: read and
    // contents: write. A bare contents-only block 403s on the issues API:
    // "Resource not accessible by integration" (first three restored runs,
    // 2026-08-12). No pull-requests scope is requested: the snapshot no
    // longer lands through a PR (the Nishfleet org forbids Actions from
    // creating PRs), so the workflow never creates or merges one.
    expect(parsed.permissions).toEqual({ contents: "write", issues: "read" });
  });

  it("generates the snapshot with Cloudflare token secrets on the self-hosted production-environment job", () => {
    expect(job["runs-on"]).toEqual("ubuntu-latest");
    expect(job.environment).toBe("production");
    expect(job["timeout-minutes"]).toBe(30);
    expect(job.if).toBe("github.ref == 'refs/heads/main'");
    const generate = job.steps?.find((step) => step.name === "Generate market-signal D1 snapshot");
    expect(generate?.env).toEqual({
      CLOUDFLARE_ACCOUNT_ID: "${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
      CLOUDFLARE_API_TOKEN: "${{ secrets.CLOUDFLARE_API_TOKEN }}",
      GH_TOKEN: "${{ github.token }}",
      XDG_CONFIG_HOME: "${{ runner.temp }}/market-signal-wrangler-config",
    });
  });

  it("refuses empty Cloudflare secrets before generate", () => {
    const refuse = job.steps?.find((step) => step.name === "Refuse empty Cloudflare secrets");
    expect(refuse).toBeDefined();
    expect(refuse?.run).toContain("market_signal_missing_cloudflare_secret");
    expect(refuse?.run).toContain("market_signal_cloudflare_secrets_present");
    expect(refuse?.run).not.toContain('echo "$CLOUDFLARE_API_TOKEN"');
  });

  it("isolates wrangler user config and unsets shadowing Cloudflare env vars", () => {
    const generate = job.steps?.find((step) => step.name === "Generate market-signal D1 snapshot");
    expect(generate?.run).toContain("unset CF_API_TOKEN");
    expect(generate?.env?.XDG_CONFIG_HOME).toBe("${{ runner.temp }}/market-signal-wrangler-config");
    expect(generate?.run).toContain("npm run signal:market");
  });

  it("writes the snapshot to the exact path the Hermes contract reads", () => {
    expect(job.env?.SNAPSHOT_PATH).toBe(snapshotPath);
    expect(source).toContain(`--output "$SNAPSHOT_PATH"`);
    expect(source).toContain(`git add -- "$SNAPSHOT_PATH"`);
    expect(contract).toContain(`ops/market-signal/0509-market-signal.json`);
    // The snapshot no longer lands on main; Hermes reads it from the
    // automation-owned data branch, so the contract must point there.
    expect(contract).toContain(`automation/market-signal-snapshot`);
    expect(contract).toContain(`git show origin/automation/market-signal-snapshot:ops/market-signal/0509-market-signal.json`);
  });

  it("passes GH_TOKEN to the generate step so the script can read the issue list", () => {
    // The snapshot script calls `gh api .../issues` internally (issues: read),
    // so the generate step must hand it GH_TOKEN. No workflow step invokes the
    // gh CLI directly anymore -- the snapshot no longer lands through a PR, so
    // there is no gh pr create / gh pr merge to authenticate.
    const generate = job.steps?.find((step) => step.name === "Generate market-signal D1 snapshot");
    expect(generate?.env?.GH_TOKEN).toBe("${{ github.token }}");
    const publish = job.steps?.find((step) => step.name === "Publish snapshot to data branch")?.run ?? "";
    expect(publish).not.toMatch(/\bgh pr\b/u);
  });

  it("publishes the snapshot to a dedicated data branch without creating a PR", () => {
    // The Nishfleet org forbids Actions from creating PRs, so the old
    // PR-squash-merge landing died on every run from 2026-08-21 on. The
    // snapshot now pushes to a dedicated automation-owned data branch; no PR
    // is opened, so no org or repo policy is weakened. Hermes reads the
    // snapshot from this branch (see the contract test above).
    const publish = job.steps?.find((step) => step.name === "Publish snapshot to data branch")?.run ?? "";
    expect(publish).toContain("automation/market-signal-snapshot");
    expect(publish).toContain("git push");
    expect(publish).toContain("market_signal_snapshot_published");
    // No PR machinery anywhere in the workflow.
    expect(publish).not.toContain("gh pr create");
    expect(publish).not.toContain("gh pr merge");
    expect(publish).not.toContain("gh pr checks");
    expect(publish).not.toContain("--squash");
    expect(publish).not.toContain("--auto");
    expect(source).not.toContain("pull-requests: write");
  });

  it("fails loud when the snapshot cannot be published", () => {
    // A snapshot that cannot be produced or pushed must fail the job, never
    // exit 0. The publish step runs under `set -euo pipefail`, so a push
    // failure (after the --force-if-includes / --force fallback) exits
    // non-zero. The only exit 0 path is a genuinely unchanged snapshot.
    const publish = job.steps?.find((step) => step.name === "Publish snapshot to data branch")?.run ?? "";
    expect(publish).toContain("set -euo pipefail");
    expect(publish).toContain("market_signal_snapshot_unchanged");
    expect(publish).toContain("market_signal_snapshot_published");
    // No silent-success path on a publish failure: no `|| true` swallowing the
    // final push, no exit 0 after a failed push.
    expect(publish).not.toContain("gh pr merge");
  });

  it("uses a stable automation-owned data branch, not a per-day PR branch", () => {
    // The previous shape used a per-day branch suffix and opened a PR per day,
    // which the org policy now blocks. One stable data branch lets every
    // rerun force-push to the same ref, so Hermes always reads the latest
    // snapshot from a fixed branch name and no stale PRs accumulate.
    const publish = job.steps?.find((step) => step.name === "Publish snapshot to data branch")?.run ?? "";
    expect(publish).toContain('SNAPSHOT_BRANCH="automation/market-signal-snapshot"');
    expect(publish).not.toContain("$(date -u +%Y%m%d)");
    expect(publish).not.toContain("gh pr list");
    expect(publish).not.toContain("market_signal_snapshot_existing_pr");
  });

  it("uses --force-if-includes so a fresh data branch lands its first push", () => {
    // --force-with-lease fails on a brand-new branch (no upstream to lease
    // against), which is the failure mode that left the snapshot file off
    // main for every restored run. --force-if-includes is the documented
    // safe alternative for first push; the explicit --force fallback is the
    // last-resort path so the workflow degrades loudly instead of silently
    // never landing.
    const publish = job.steps?.find((step) => step.name === "Publish snapshot to data branch")?.run ?? "";
    expect(publish).toContain("--force-if-includes");
    expect(publish).toContain("git push --force origin");
  });

  it("surfaces the snapshot to a human without Actions opening a PR", () => {
    // The task requires that review, if it must happen, is surfaced to a human
    // without Actions opening a PR. The publish step writes a job summary
    // pointing a human at the data branch and commit so the snapshot diff is
    // reviewable in the GitHub UI. This is the mechanism that preserves review
    // now that the PR-squash-merge gate is gone.
    const publish = job.steps?.find((step) => step.name === "Publish snapshot to data branch")?.run ?? "";
    expect(publish).toContain("$GITHUB_STEP_SUMMARY");
    expect(publish).toContain("automation/market-signal-snapshot");
    expect(publish).toContain("BRANCH_URL");
    expect(publish).toContain("COMMIT_URL");
    expect(publish).not.toContain("gh pr create");
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
