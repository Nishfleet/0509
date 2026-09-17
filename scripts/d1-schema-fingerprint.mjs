#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** @param {string} path */
function isSchemaInput(path) {
  return path.startsWith("migrations/") ||
    path === "scripts/d1-restore-transform.mjs" ||
    /^scripts\/d1-remote-restore-evidence[^/]*\.mjs$/u.test(path) ||
    path === "wrangler.jsonc";
}

/** SHA256 of sorted [path, SHA256(contents)] records. Names and file boundaries
 * are significant; mtimes, traversal order and non-schema files are not.
 * A commit reads immutable Git blobs, never another run's worktree.
 * @param {string} root
 * @param {string} [commit]
 */
export function schemaFingerprint(root = process.cwd(), commit) {
  /** @param {string[]} args */
  const git = (args) => execFileSync("git", args, {
    cwd: root, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
  });
  if (commit !== undefined && !/^[a-f0-9]{40}$/u.test(commit)) {
    throw new Error("d1_schema_commit_invalid");
  }
  const paths = commit
    ? git(["ls-tree", "-r", "--name-only", "-z", commit]).toString().split("\0").filter(isSchemaInput)
    : [
        ...readdirSync(resolve(root, "migrations"), { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => resolve(entry.parentPath, entry.name).slice(resolve(root).length + 1)),
        ...readdirSync(resolve(root, "scripts")).map((name) => `scripts/${name}`).filter(isSchemaInput),
        "wrangler.jsonc",
      ];
  for (const required of ["wrangler.jsonc", "scripts/d1-restore-transform.mjs", "scripts/d1-remote-restore-evidence.mjs"]) {
    if (!paths.includes(required)) throw new Error(`d1_schema_input_missing:${required}`);
  }
  if (!paths.some((path) => path.startsWith("migrations/"))) throw new Error("d1_schema_migrations_missing");
  const records = paths.sort().map((path) => [path, createHash("sha256")
    .update(commit ? git(["show", `${commit}:${path}`]) : readFileSync(resolve(root, path)))
    .digest("hex")]);
  return createHash("sha256").update(JSON.stringify(records)).digest("hex");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${schemaFingerprint()}\n`);
}
