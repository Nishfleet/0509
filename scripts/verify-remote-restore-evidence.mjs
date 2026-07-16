#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { validateRemoteRestoreEvidence } from "./deploy-production-plan.mjs";

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

try {
  const manifestPath = readArg("--manifest");
  const evidencePath = readArg("--remote-evidence");
  if (!manifestPath || !evidencePath) throw new Error("remote_restore_evidence_arguments_missing");
  const manifest = JSON.parse(readFileSync(resolve(manifestPath), "utf8"));
  const evidence = JSON.parse(readFileSync(resolve(evidencePath), "utf8"));
  const migrations = readdirSync(resolve("migrations"))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  const verdict = validateRemoteRestoreEvidence(evidence, {
    candidateFingerprint: manifest.candidateFingerprint,
    wranglerWorktreeSha256: manifest.postflight?.launchConfig?.wranglerWorktreeSha256,
    latestMigration: migrations.at(-1),
    migrationCount: migrations.length,
  });
  process.stdout.write(`${JSON.stringify(verdict)}\n`);
  if (!verdict.ok) process.exitCode = 1;
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    issues: [error instanceof Error ? error.message : "remote_restore_evidence_unavailable"],
  })}\n`);
  process.exitCode = 1;
}
