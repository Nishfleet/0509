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

  it("generates the snapshot with Cloudflare token secrets on a GitHub-hosted production-environment job", () => {
    expect(job["runs-on"]).toBe("ubuntu-latest");
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
    const commands = job.steps?.map((step) => step.run).filter(Boolean) ?? [];
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
    expect(source).toContain("git push origin HEAD:main");
    expect(contract).toContain(`ops/market-signal/0509-market-signal.json`);
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
