import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { schemaFingerprint } from "../scripts/d1-schema-fingerprint.mjs";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "0509-schema-"));
  roots.push(root);
  mkdirSync(join(root, "scripts"));
  cpSync(resolve("migrations"), join(root, "migrations"), { recursive: true });
  for (const path of ["wrangler.jsonc", "scripts/d1-restore-transform.mjs", "scripts/d1-remote-restore-evidence.mjs", "scripts/d1-remote-restore-evidence-core.mjs"]) {
    cpSync(resolve(path), join(root, path));
  }
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("D1 schema fingerprint", () => {
  it("hashes sorted inputs identically on disk and at a commit, ignoring non-schema commits", () => {
    const root = fixture();
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
    git("init", "-q");
    git("add", ".");
    git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "schema");
    const prior = git("rev-parse", "HEAD").trim();
    const before = schemaFingerprint(root);
    writeFileSync(join(root, "README.md"), "Non-schema commit\n");
    git("add", ".");
    git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "docs");
    expect([before, schemaFingerprint(root, prior), schemaFingerprint(root, git("rev-parse", "HEAD").trim())]).toEqual([before, before, before]);
    expect(before).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each(["migrations/nested/new.sql", "scripts/d1-restore-transform.mjs", "scripts/d1-remote-restore-evidence.mjs", "scripts/d1-remote-restore-evidence-core.mjs", "scripts/d1-remote-restore-evidence-new.mjs", "wrangler.jsonc"])("invalidates evidence after changing %s", (path) => {
    const root = fixture();
    const before = schemaFingerprint(root);
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), "changed\n");
    expect(schemaFingerprint(root)).not.toBe(before);
  });

  it("includes names and fails closed on missing required inputs", () => {
    const root = fixture();
    const before = schemaFingerprint(root);
    renameSync(join(root, "scripts/d1-remote-restore-evidence-core.mjs"), join(root, "scripts/d1-remote-restore-evidence-renamed.mjs"));
    expect(schemaFingerprint(root)).not.toBe(before);
    rmSync(join(root, "wrangler.jsonc"));
    expect(() => schemaFingerprint(root)).toThrow();
  });
});
