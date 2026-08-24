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

  // The launch-readiness endpoint returns 503 with a JSON body listing
  // `blockers` when readiness is red. The canary used to call curl with
  // `--fail`, which made curl exit 22 on 503 so the python block that prints
  // the blockers never ran: a red canary reported only
  // "curl: (22) ... error: 503" and could not name what failed
  // (run 32689088190, 2026-08-24). These pins assert the observable contract
  // — the HTTP code and body are both captured for any status, a 503 with a
  // parseable body prints `meta canary: red` plus the blockers and still
  // exits non-zero — without coupling to source line positions.

  it("captures the HTTP status and body for any status instead of failing on 503", () => {
    const job = parsed.jobs["meta-readiness"];
    const readinessRun = job?.steps?.find((step) => step.id === "readiness")?.run ?? "";
    // `--fail` is the defect: it makes curl exit 22 on 503 and discard the
    // body that names the blockers. The curl call must not use it.
    const curlCall = readinessRun.match(/curl [^\n]*\n(?:[^\n]*\n)*?\s+"\$READINESS_URL"/s);
    expect(curlCall, "expected a curl invocation against READINESS_URL").toBeTruthy();
    expect(curlCall![0]).not.toContain("--fail");
    // The HTTP code must be captured via --write-out and the body via
    // --output, so a 503 body reaches the python verdict block.
    expect(readinessRun).toContain("--write-out");
    expect(readinessRun).toContain("--output");
    // The retry/timeout budget is part of the contract.
    expect(readinessRun).toContain("--max-time 20");
    expect(readinessRun).toContain("--retry 2");
    expect(readinessRun).toContain("--retry-delay 5");
  });

  it("prints `meta canary: red` and the blockers on a 503, and still exits non-zero", () => {
    const job = parsed.jobs["meta-readiness"];
    const readinessRun = job?.steps?.find((step) => step.id === "readiness")?.run ?? "";
    // The python verdict block must read both the HTTP code and the body.
    expect(readinessRun).toContain("READINESS_HTTP_CODE");
    expect(readinessRun).toContain("READINESS_RESPONSE");
    // A 503 is an expected status whose body must be parsed, not a transport
    // failure; the only unexpected statuses are non-2xx/non-503.
    expect(readinessRun).toMatch(/code not in \(.?"200"?,\s*.?"503"?\)/);
    // The verdict prints the red/green line and the blockers line for every
    // parseable body, including a 503.
    expect(readinessRun).toContain("meta canary:");
    expect(readinessRun).toContain("blockers=");
    // A 503 (or any non-green body) must raise SystemExit so the step exits
    // non-zero and never writes state=green. The green marker is only
    // reached after the python block completes without raising.
    expect(readinessRun).toMatch(/raise SystemExit\(/);
    expect(readinessRun).toMatch(/code != .?"200"?|not overall_ok|not meta_ok/);
  });
});
