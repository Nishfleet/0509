import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

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
  //
  // On 2026-08-24 (run 32689088190) a second defect surfaced: the step used
  // `curl --fail`, so a 503 from the launch-readiness endpoint made curl exit
  // 22 before the response body was ever parsed. A red canary reported only
  // "curl: (22) ... error: 503" and could not name which blockers fired. The
  // tests below assert the observable contract: the HTTP status and body are
  // captured for any status, and the python verdict prints the blockers and
  // exits non-zero on red, never zero.

  const readinessRun =
    parsed.jobs["meta-readiness"]?.steps?.find((step) => step.id === "readiness")?.run ?? "";

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

  it("captures the HTTP status and body for any status instead of failing fast on 503", () => {
    // The old step used `curl --fail`, which made curl exit 22 on the
    // endpoint's intentional 503 and discarded the body that names the
    // blockers. The fix drops --fail from the curl invocation and uses
    // --write-out to capture the code, keeping --max-time / --retry /
    // --retry-delay. (The word "--fail" may still appear in an explanatory
    // comment; what matters is the curl command itself no longer sets it.)
    const curlBlock = readinessRun.match(/curl[\s\S]*?\$READINESS_URL"\)/)?.[0] ?? "";
    expect(curlBlock).toBeTruthy();
    expect(curlBlock).not.toContain("--fail");
    expect(curlBlock).toContain("--write-out");
    expect(curlBlock).toContain("--max-time 20");
    expect(curlBlock).toContain("--retry 2");
    expect(curlBlock).toContain("--retry-delay 5");
    // The captured code is handed to the python verdict, not used as the
    // curl exit signal.
    expect(readinessRun).toContain("READINESS_HTTP_CODE");
  });

  // The remaining assertions exercise the actual python verdict logic
  // extracted from the run script, so they assert behaviour (stdout + exit
  // code) rather than source line positions. Reformatting the step cannot
  // break them as long as the contract holds.
  const pythonVerdict = extractPythonVerdict(readinessRun);

  function runVerdict(httpCode: string, body: string): {
    stdout: string;
    stderr: string;
    status: number | null;
  } {
    expect(pythonVerdict).toBeTruthy();
    const result = spawnSync("python3", ["-c", pythonVerdict], {
      env: {
        ...process.env,
        READINESS_HTTP_CODE: httpCode,
        READINESS_RESPONSE: body,
      },
      encoding: "utf8",
    });
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      status: result.status,
    };
  }

  it("stays green on 200 with ok:true and metaAdsBeta.ok:true", () => {
    const body = JSON.stringify({
      ok: true,
      blockers: [],
      metaAdsBeta: { ok: true, samples: 12, sampleTarget: 10, successRate: 1, blockers: [] },
    });
    const out = runVerdict("200", body);
    expect(out.status).toBe(0);
    expect(out.stdout).toContain("meta canary: green");
  });

  it("prints blockers and exits non-zero on a 503 with a parseable red body", () => {
    const body = JSON.stringify({
      ok: false,
      blockers: ["no_recent_monitoring_run", "meta_ads_beta:insufficient_samples"],
      metaAdsBeta: {
        ok: false,
        samples: 2,
        sampleTarget: 10,
        successRate: 0.2,
        blockers: ["insufficient_samples"],
      },
    });
    const out = runVerdict("503", body);
    expect(out.status).not.toBe(0);
    expect(out.status).not.toBe(null);
    expect(out.stdout).toContain("meta canary: red");
    // The blocker names must land in the log so a red canary names what
    // failed, not just "error: 503".
    expect(out.stdout).toContain("blockers=no_recent_monitoring_run,meta_ads_beta:insufficient_samples");
    expect(out.stdout).toContain("samples=2");
    expect(out.stdout).toContain("target=10");
    expect(out.stdout).toContain("success_rate=0.2");
  });

  it("fails loud on an unexpected (non-2xx/non-503) status, never exit 0", () => {
    const body = JSON.stringify({ ok: true, blockers: [], metaAdsBeta: { ok: true, blockers: [] } });
    const out = runVerdict("404", body);
    expect(out.status).not.toBe(0);
    expect(out.status).not.toBe(null);
    expect(out.stderr.toLowerCase()).toContain("unexpected");
  });

  it("fails loud on an unparseable body, never exit 0", () => {
    const out = runVerdict("200", "not-json<{>}");
    expect(out.status).not.toBe(0);
    expect(out.status).not.toBe(null);
    expect(out.stderr.toLowerCase()).toContain("unparseable");
  });

  it("fails loud on a 503 with an unparseable body, never exit 0", () => {
    const out = runVerdict("503", "internal server error html");
    expect(out.status).not.toBe(0);
    expect(out.status).not.toBe(null);
    expect(out.stderr.toLowerCase()).toContain("unparseable");
  });

  it("treats a 200 with overall ok:false as red and exits non-zero", () => {
    // A 200 that lies about readiness is a contract violation, not green.
    const body = JSON.stringify({
      ok: false,
      blockers: ["no_recent_monitoring_run"],
      metaAdsBeta: { ok: true, samples: 12, sampleTarget: 10, successRate: 1, blockers: [] },
    });
    const out = runVerdict("200", body);
    expect(out.status).not.toBe(0);
    expect(out.status).not.toBe(null);
    expect(out.stdout).toContain("meta canary: red");
  });
});

// Pull the python heredoc (the block between `<<'PY'` and a line holding just
// `PY`) out of the readiness step's run script. Returns the verbatim python
// source, which reads READINESS_HTTP_CODE and READINESS_RESPONSE from env —
// the same inputs the workflow passes. Empty string if not found.
function extractPythonVerdict(run: string): string {
  const match = run.match(/<<'PY'\n([\s\S]*?)\nPY\b/);
  return match ? match[1] : "";
}
