import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("Meta discovery canary workflow", () => {
  const workflow = readFileSync(".github/workflows/meta-discovery-canary.yml", "utf8");
  const parsed = parse(workflow) as {
    on: {
      workflow_dispatch?: unknown;
      schedule?: Array<{ cron?: string }>;
    };
    permissions?: Record<string, string>;
    jobs: {
      "meta-readiness"?: {
        environment?: string;
        permissions?: Record<string, string>;
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

  // Between 2026-08-18 and 2026-08-22 every scheduled run of this workflow
  // exited 0 as "skipped (missing CANARY_BYPASS_TOKEN)" because the job never
  // declared the environment that owns the secret, so GitHub showed a green
  // check for a canary that had checked nothing. These pins keep both halves
  // of that failure impossible: the token must resolve, and any run that
  // cannot prove a verdict must fail loudly instead of succeeding.

  it("reads its token from the production environment that owns the secret", () => {
    expect(parsed.on.schedule).toEqual([{ cron: "23 */3 * * *" }]);
    expect(parsed.on.workflow_dispatch).toBeDefined();
    expect(parsed.permissions).toEqual({ contents: "read" });
    const job = parsed.jobs["meta-readiness"];
    expect(job?.environment).toBe("production");
    const readiness = job?.steps?.find((step) => step.id === "readiness");
    expect(readiness?.env?.READINESS_URL).toBe("https://0509.io/api/launch-readiness");
    expect(readiness?.env?.CANARY_BYPASS_TOKEN).toBe(
      "${{ secrets.CANARY_BYPASS_TOKEN }}",
    );
  });

  it("fails loudly when it cannot produce a verdict, never skips as success", () => {
    const job = parsed.jobs["meta-readiness"];
    const readinessRun = job?.steps?.find((step) => step.id === "readiness")?.run ?? "";
    const missingTokenBlock = [
      'if [ -z "${CANARY_BYPASS_TOKEN:-}" ]; then',
      '  echo "meta canary: red (missing CANARY_BYPASS_TOKEN; a canary that cannot check must fail, not skip as success)" >&2',
      '  echo "state=missing-token" >> "$GITHUB_OUTPUT"',
      "  exit 1",
      "fi",
    ];
    expect(readinessRun).toContain(missingTokenBlock.join("\n"));
    // The green state marker may only be written after the readiness probe's
    // python verdict passes; nothing else in the step writes success states.
    expect(readinessRun.match(/state=green/g)).toHaveLength(1);

    const persist = job?.steps?.find((step) => step.name === "Persist canary state evidence");
    const upload = job?.steps?.find((step) => step.name === "Upload canary state evidence");
    // Red and missing-token runs must still publish their state artifact, so
    // the published history shows red rather than an absent record.
    expect(persist?.if).toContain("always()");
    expect(upload?.if).toContain("always()");
    expect(persist?.env?.STATE).toBe("${{ steps.readiness.outputs.state || 'red' }}");
    expect(upload?.with?.["if-no-files-found"]).toBe("error");
  });
});
