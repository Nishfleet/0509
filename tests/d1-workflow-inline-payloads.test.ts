import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

/**
 * Runs the inline `node -e` payloads that the D1 restore-evidence workflow
 * embeds as shell strings.
 *
 * Why this file exists: a workflow-shape test can only assert that a step's
 * `run` string contains certain text. It cannot catch the payload failing to
 * PARSE. The first cut of the issue #2779 gate had `return;` at the top level
 * of a `node -e` script — a parse-time SyntaxError, so the bookmark step could
 * never succeed and the remote apply became permanently unreachable. Every
 * existing assertion in tests/d1-remote-restore-evidence.test.ts passed while
 * that was true.
 *
 * So this file extracts the payload from the YAML and executes it with the
 * same argv and environment shape the runner uses.
 */

const workflow = parse(
  readFileSync(".github/workflows/d1-remote-restore-evidence.yml", "utf8"),
) as {
  jobs: Record<
    string,
    { steps?: Array<{ name?: string; run?: string }> }
  >;
};

const steps = workflow.jobs.apply_and_restore?.steps ?? [];

function stepNamed(name: string) {
  const step = steps.find((candidate) => candidate.name === name);
  if (step?.run === undefined) {
    throw new Error(`workflow step not found: ${name}`);
  }
  return step;
}

/**
 * Pull the payload out of `node -e '<payload>' "<arg>" "<arg>"`. The payload
 * is single-quoted in YAML, so the terminator is the `'` that begins the
 * first argument.
 */
function extractNodePayload(run: string, marker: string) {
  const start = run.indexOf("node -e '");
  const end = run.indexOf(marker, start);
  if (start < 0 || end < 0) {
    throw new Error("node payload not found in workflow step");
  }
  return run.slice(start + "node -e '".length, end);
}

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "0509-workflow-payload-"));
  temps.push(dir);
  return dir;
}

function runPayload(
  payload: string,
  args: string[],
  env: Record<string, string>,
) {
  const result = spawnSync(process.execPath, ["-e", payload, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("D1 restore-evidence workflow inline payloads execute", () => {
  it("the pending-migration payload parses and reports exactly what wrangler returned", () => {
    const run = stepNamed("Detect pending repository migrations").run ?? "";
    const payload = extractNodePayload(run, "' \"$RUNNER_TEMP");
    const dir = tempDir();
    const outputPath = join(dir, "github_output");
    const inputPath = join(dir, "pending.json");
    writeFileSync(
      inputPath,
      JSON.stringify([
        { Name: "0090_event_type_free_text.sql" },
        { Name: "0091_demo_brand_proof_hole_state.sql" },
      ]),
    );
    // `node -e` puts the first script argument at argv[1], which is why the
    // workflow passes the input file first.
    const result = runPayload(payload, [inputPath, outputPath], {
      GITHUB_OUTPUT: outputPath,
    });
    expect(result.stderr).not.toContain("SyntaxError");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      'pending_migrations:["0090_event_type_free_text.sql","0091_demo_brand_proof_hole_state.sql"]',
    );
    expect(readFileSync(outputPath, "utf8")).toContain(
      'pending=["0090_event_type_free_text.sql","0091_demo_brand_proof_hole_state.sql"]',
    );
  });

  it("the pending-migration payload fails closed on an unparsable ledger", () => {
    const run = stepNamed("Detect pending repository migrations").run ?? "";
    const payload = extractNodePayload(run, "' \"$RUNNER_TEMP");
    const dir = tempDir();
    const outputPath = join(dir, "github_output");
    const inputPath = join(dir, "pending.json");
    writeFileSync(inputPath, "not json");

    const result = runPayload(payload, [inputPath, outputPath], {
      GITHUB_OUTPUT: outputPath,
    });
    expect(result.stderr).toContain("remote_pending_unparsable");
    expect(result.status).toBe(1);
  });

  it("the pending-migration payload refuses a name that is not a repository migration", () => {
    const run = stepNamed("Detect pending repository migrations").run ?? "";
    const payload = extractNodePayload(run, "' \"$RUNNER_TEMP");
    const dir = tempDir();
    const outputPath = join(dir, "github_output");
    const inputPath = join(dir, "pending.json");
    // The drift case: the response shape moved again. A non-empty array that
    // yields no recognised field is a failure, not an empty pending set.
    writeFileSync(
      inputPath,
      JSON.stringify([{ name: "0000_auth.sql" }]),
    );

    const result = runPayload(payload, [inputPath, outputPath], {
      GITHUB_OUTPUT: outputPath,
    });
    expect(result.stderr).toContain("remote_pending_shape_unrecognised");
    expect(result.status).toBe(1);

    // A genuinely empty response is a legitimate no-op.
    writeFileSync(inputPath, JSON.stringify([]));
    const empty = runPayload(payload, [inputPath, outputPath], {
      GITHUB_OUTPUT: outputPath,
    });
    expect(empty.status).toBe(0);
    expect(empty.stdout).toContain("pending_migrations:[]");

    // A populated set with an unknown name IS a failure.
    writeFileSync(
      inputPath,
      JSON.stringify([{ Name: "9999_not_a_migration.sql" }]),
    );
    const drifted = runPayload(payload, [inputPath, outputPath], {
      GITHUB_OUTPUT: outputPath,
    });
    expect(drifted.stderr).toContain("remote_pending_unknown");
    expect(drifted.status).toBe(1);
  });

  it("the Time Travel bookmark payload parses and records a rollback command", () => {
    const run = stepNamed("Record D1 Time Travel bookmark before apply").run ?? "";
    const payload = extractNodePayload(run, "' \"$RUNNER_TEMP");
    const dir = tempDir();
    const outputPath = join(dir, "github_output");
    const summaryPath = join(dir, "summary");
    const sidecarPath = join(dir, "bookmark.json");
    const inputPath = join(dir, "time-travel.json");
    // The shape `wrangler d1 time-travel info --json` emits: the handler logs
    // `JSON.stringify(getBookmarkIdFromTimestamp(...))`, which is `{ bookmark }`.
    writeFileSync(
      inputPath,
      JSON.stringify({ bookmark: "0000001a-0000000c-00000000-0000" }),
    );
    writeFileSync(outputPath, "");
    writeFileSync(summaryPath, "");

    const result = runPayload(payload, [inputPath, sidecarPath], {
      GITHUB_OUTPUT: outputPath,
      GITHUB_STEP_SUMMARY: summaryPath,
    });

    // The regression this test exists for: a top-level `return` in a `node -e`
    // script is a parse-time error, which made this step impossible to pass.
    expect(result.stderr).not.toContain("SyntaxError");
    expect(result.status).toBe(0);
    expect(readFileSync(outputPath, "utf8")).toContain(
      "bookmark=0000001a-0000000c-00000000-0000",
    );
    const record = JSON.parse(readFileSync(sidecarPath, "utf8")) as {
      bookmark: string;
      rollbackCommand: string;
      database: string;
    };
    expect(record.bookmark).toBe("0000001a-0000000c-00000000-0000");
    expect(record.rollbackCommand).toContain(
      "wrangler d1 time-travel restore 0509 --bookmark 0000001a",
    );
    expect(record.database).toBe("0509");
    expect(readFileSync(summaryPath, "utf8")).toContain(
      "## D1 Time Travel bookmark (pre-apply)",
    );
  });

  it("the Time Travel bookmark payload fails closed when the bookmark is absent", () => {
    const run = stepNamed("Record D1 Time Travel bookmark before apply").run ?? "";
    const payload = extractNodePayload(run, "' \"$RUNNER_TEMP");
    const dir = tempDir();
    const outputPath = join(dir, "github_output");
    const sidecarPath = join(dir, "bookmark.json");
    const inputPath = join(dir, "time-travel.json");
    writeFileSync(inputPath, JSON.stringify({ success: true }));

    const result = runPayload(payload, [inputPath, sidecarPath], {
      GITHUB_OUTPUT: outputPath,
      GITHUB_STEP_SUMMARY: join(dir, "summary"),
    });
    expect(result.stderr).toContain("time_travel_bookmark_missing");
    expect(result.status).toBe(1);
  });

  it("every inline node payload in the workflow parses", () => {
    // Cheap structural backstop: any future step that adds a `node -e` block
    // with a syntax error fails here instead of at prod-apply time.
    const offenders: string[] = [];
    for (const step of steps) {
      const run = step.run ?? "";
      if (!run.includes("node -e '")) continue;
      const payload = extractNodePayload(run, "' \"$RUNNER_TEMP");
      const result = spawnSync(process.execPath, ["--check", "-"], {
        input: payload,
        encoding: "utf8",
      });
      if (result.status !== 0) {
        offenders.push(`${step.name}: ${result.stderr.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
