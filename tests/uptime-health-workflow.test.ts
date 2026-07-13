import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("uptime health workflow", () => {
  const workflow = readFileSync(".github/workflows/uptime-health.yml", "utf8");
  const parsed = parse(workflow) as {
    on: {
      workflow_dispatch?: unknown;
      schedule?: Array<{ cron?: string }>;
    };
    permissions?: Record<string, string>;
    jobs: {
      health?: {
        "timeout-minutes"?: number;
        steps?: Array<{ name?: string; run?: string; env?: Record<string, string> }>;
      };
    };
  };

  it("checks the public health endpoint on an offset five-minute GitHub schedule", () => {
    expect(parsed.on.workflow_dispatch).toBeDefined();
    expect(parsed.on.schedule).toEqual([
      { cron: "2,7,12,17,22,27,32,37,42,47,52,57 * * * *" },
    ]);
    expect(parsed.jobs.health?.["timeout-minutes"]).toBe(4);

    const healthStep = parsed.jobs.health?.steps?.find((step) => step.name === "Check production health endpoint");
    expect(healthStep?.env?.HEALTH_URL).toBe("https://0509.io/api/health");
    expect(healthStep?.run).toContain("curl --fail --show-error --silent --max-time 20 --retry 2");
    expect(healthStep?.run).toContain('payload.get("status") != "ok"');
    expect(healthStep?.run).toContain('payload.get("app") != "0509"');
  });

  it("fails the run when the deep D1 health check is not ok", () => {
    const deepStep = parsed.jobs.health?.steps?.find(
      (step) => step.name === "Check production deep health endpoint (D1)",
    );
    expect(deepStep?.env?.DEEP_HEALTH_URL).toBe("https://0509.io/api/health/deep");
    expect(deepStep?.run).toContain("curl --fail --show-error --silent --max-time 20 --retry 2");
    expect(deepStep?.run).toContain('checks.get("d1") != "ok"');
  });

  it("does not require secrets or private canary tokens", () => {
    expect(parsed.permissions).toEqual({ contents: "read" });
    expect(workflow).not.toContain("secrets.");
    expect(workflow).not.toContain("CANARY_BYPASS_TOKEN");
    expect(workflow).not.toContain("CLOUDFLARE_API_TOKEN");
    expect(workflow).not.toContain("DODO");
  });
});
