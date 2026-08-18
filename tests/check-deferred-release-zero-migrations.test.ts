/**
 * Behaviour of the deferred-release schema gate.
 *
 * The gate this replaces caused three production rollbacks on 2026-08-06
 * precisely because nothing ever executed it — only its shape was asserted. So
 * these tests drive the real logic through an injected executor and cover every
 * refusal path, because on a gate guarding a database the interesting cases are
 * all the ones where it must say no.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
  GateRefusal,
  checkDeferredRelease,
  compareMigrations,
  ensureCommitPresent,
  resolveLiveSha,
  writeBaselineEvidence,
  BASELINE_EVIDENCE_PATH,
} = await import("../scripts/check-deferred-release-zero-migrations.mjs");

const LIVE = "a".repeat(40);

/** Build an executor from a map of "command arg arg" prefixes to results. */
function execFrom(handlers: Array<[RegExp, { status: number; stdout?: string; stderr?: string }]>) {
  return (command: string, args: string[]) => {
    const line = `${command} ${args.join(" ")}`;
    for (const [pattern, result] of handlers) {
      if (pattern.test(line)) {
        return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
      }
    }
    throw new Error(`unexpected command in test: ${line}`);
  };
}

const ghSuccess = (sha = LIVE): [RegExp, any] => [
  /^gh run list/u,
  { status: 0, stdout: JSON.stringify([{ headSha: sha }]) },
];
const commitPresent: [RegExp, any] = [/^git cat-file/u, { status: 0 }];

describe("resolveLiveSha", () => {
  it("asks GitHub for exactly the right run: this workflow, successful, newest", () => {
    // The filters ARE the gate. Drop --workflow and it can pick an unrelated
    // workflow's run; drop --status success and a failed run becomes the
    // baseline; drop --limit 1 and "newest" stops being guaranteed. Any of
    // those could select the candidate's own HEAD and wave a schema change
    // through, so the exact argv is asserted rather than merely "some gh call".
    let seen: string[] | undefined;
    const exec = (command: string, args: string[]) => {
      seen = [command, ...args];
      return { status: 0, stdout: JSON.stringify([{ headSha: LIVE }]), stderr: "" };
    };
    resolveLiveSha(exec);
    expect(seen).toEqual([
      "gh",
      "run", "list",
      "--repo", "Nishfleet/0509",
      "--workflow", "deploy-production.yml",
      "--status", "success",
      "--limit", "1",
      "--json", "headSha",
    ]);
  });

  it("uses the newest successful production deploy", () => {
    expect(resolveLiveSha(execFrom([ghSuccess()]))).toBe(LIVE);
  });

  it("refuses when GitHub cannot be asked", () => {
    expect(() =>
      resolveLiveSha(execFrom([[/^gh run list/u, { status: 1, stderr: "HTTP 401" }]])),
    ).toThrow(/Refusing to assume/u);
  });

  it("refuses when no successful release exists", () => {
    expect(() =>
      resolveLiveSha(execFrom([[/^gh run list/u, { status: 0, stdout: "[]" }]])),
    ).toThrow(/no live commit/u);
  });

  it("refuses on an unparsable answer", () => {
    expect(() =>
      resolveLiveSha(execFrom([[/^gh run list/u, { status: 0, stdout: "not json" }]])),
    ).toThrow(/JSON/u);
  });

  it("refuses a malformed sha rather than trusting it", () => {
    expect(() =>
      resolveLiveSha(
        execFrom([[/^gh run list/u, { status: 0, stdout: JSON.stringify([{ headSha: "abc" }]) }]]),
      ),
    ).toThrow(/no live commit/u);
  });

  it("takes no environment override", () => {
    // A single env line must not be able to point the baseline at the
    // candidate's own HEAD and wave a schema change through.
    process.env.LIVE_RELEASE_SHA = "b".repeat(40);
    process.env.DEPLOY_WORKFLOW_FILE = "ci.yml";
    try {
      expect(resolveLiveSha(execFrom([ghSuccess()]))).toBe(LIVE);
    } finally {
      delete process.env.LIVE_RELEASE_SHA;
      delete process.env.DEPLOY_WORKFLOW_FILE;
    }
  });
});

describe("ensureCommitPresent", () => {
  it("does nothing when the commit is already here", () => {
    expect(() => ensureCommitPresent(LIVE, execFrom([commitPresent]))).not.toThrow();
  });

  it("accepts a commit that arrives via fetch", () => {
    let present = false;
    const exec = (command: string, args: string[]) => {
      const line = `${command} ${args.join(" ")}`;
      if (line.startsWith("git cat-file")) return { status: present ? 0 : 1, stdout: "", stderr: "" };
      if (line.startsWith("git fetch")) {
        present = true;
        return { status: 0, stdout: "", stderr: "" };
      }
      throw new Error(`unexpected: ${line}`);
    };
    expect(() => ensureCommitPresent(LIVE, exec)).not.toThrow();
  });

  it("refuses when a fetch reports success but the commit is still missing", () => {
    // Judged on whether the object is actually present, never on the fetch's
    // exit code - otherwise this falls through and dies later as a misleading
    // comparison failure.
    expect(() =>
      ensureCommitPresent(
        LIVE,
        execFrom([[/^git cat-file/u, { status: 1 }], [/^git fetch/u, { status: 0 }]]),
      ),
    ).toThrow(/could not be fetched/u);
  });

  it("refuses when the fetch fails", () => {
    expect(() =>
      ensureCommitPresent(
        LIVE,
        execFrom([[/^git cat-file/u, { status: 1 }], [/^git fetch/u, { status: 128, stderr: "no creds" }]]),
      ),
    ).toThrow(/could not be fetched/u);
  });
});

describe("compareMigrations", () => {
  it("reports no change when git says the trees match", () => {
    expect(compareMigrations(LIVE, execFrom([[/^git diff --quiet/u, { status: 0 }]]))).toEqual({
      changed: false,
      files: [],
    });
  });

  it("reports the changed files when they differ", () => {
    const result = compareMigrations(
      LIVE,
      execFrom([
        [/^git diff --quiet/u, { status: 1 }],
        [/^git diff --name-only/u, { status: 0, stdout: "migrations/0071_a.sql\nmigrations/0072_b.sql" }],
      ]),
    );
    expect(result.changed).toBe(true);
    expect(result.files).toEqual(["migrations/0071_a.sql", "migrations/0072_b.sql"]);
  });

  it("refuses on a real git error instead of guessing", () => {
    // exit >= 2 is neither "same" nor "differs" and must not be read as either.
    expect(() =>
      compareMigrations(LIVE, execFrom([[/^git diff --quiet/u, { status: 128, stderr: "bad object" }]])),
    ).toThrow(/Refusing to assume/u);
  });
});

describe("checkDeferredRelease", () => {
  it("passes a release that leaves the schema alone", () => {
    const result = checkDeferredRelease(
      execFrom([ghSuccess(), commitPresent, [/^git diff --quiet/u, { status: 0 }]]),
    );
    expect(result).toEqual({ ok: true, baselineSha: LIVE, migrationFileCount: 0 });
  });

  it("blocks a deferred release that changes the schema, naming the files", () => {
    let refusal: any;
    try {
      checkDeferredRelease(
        execFrom([
          ghSuccess(),
          commitPresent,
          [/^git diff --quiet/u, { status: 1 }],
          [/^git diff --name-only/u, { status: 0, stdout: "migrations/0075_c.sql" }],
        ]),
      );
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(GateRefusal);
    expect(refusal.reason).toBe("deferred_release_changes_schema");
    expect(refusal.detail).toContain("migrations/0075_c.sql");
    expect(refusal.detail).toContain("WITHOUT fresh backup proof");
  });

  it("never reports success when the baseline cannot be established", () => {
    for (const handlers of [
      [[/^gh run list/u, { status: 1, stderr: "boom" }]],
      [[/^gh run list/u, { status: 0, stdout: "[]" }]],
      [ghSuccess(), [/^git cat-file/u, { status: 1 }], [/^git fetch/u, { status: 1 }]],
    ] as any[]) {
      expect(() => checkDeferredRelease(execFrom(handlers))).toThrow(GateRefusal);
    }
  });
});

describe("baseline evidence", () => {
  it("records the baseline that was actually used", () => {
    const base = mkdtempSync(join(tmpdir(), "deferred-baseline-"));
    const written = writeBaselineEvidence(
      { ok: true, baselineSha: LIVE, migrationFileCount: 0 },
      base,
    );
    expect(written).toBe(join(base, BASELINE_EVIDENCE_PATH));
    const parsed = JSON.parse(readFileSync(written, "utf8"));
    expect(parsed.baselineSha).toBe(LIVE);
    expect(parsed.migrationFileCount).toBe(0);
    expect(parsed.schemaVersion).toBe(1);
  });
});
