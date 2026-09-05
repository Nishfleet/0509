#!/usr/bin/env node

import {
  chmodSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;

/** @param {Record<string, any>} candidate */
export function buildRemoteRestoreCandidateManifest(candidate) {
  if (
    candidate?.ok !== true ||
    candidate?.status?.hasChanges !== false ||
    !COMMIT_PATTERN.test(candidate?.headCommit ?? "") ||
    !SHA256_PATTERN.test(candidate?.fingerprint ?? "") ||
    !SHA256_PATTERN.test(candidate?.wrangler?.worktreeSha256 ?? "") ||
    candidate?.wrangler?.worktreeSearchRolloutMode !== "v2"
  ) {
    throw new Error("remote_restore_candidate_manifest_invalid");
  }
  return {
    candidateFingerprint: candidate.fingerprint,
    headCommit: candidate.headCommit,
    postflight: {
      launchConfig: {
        wranglerWorktreeSha256:
          candidate.wrangler.worktreeSha256,
      },
    },
  };
}

/** @param {string} name */
function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function main() {
  const candidatePath = readArg("--candidate");
  const outputPath = readArg("--output");
  if (!candidatePath || !outputPath) {
    throw new Error("remote_restore_candidate_manifest_arguments_missing");
  }
  const candidate = JSON.parse(
    readFileSync(resolve(candidatePath), "utf8"),
  );
  const manifest = buildRemoteRestoreCandidateManifest(candidate);
  const resolvedOutput = resolve(outputPath);
  mkdirSync(resolve(resolvedOutput, ".."), { recursive: true });
  writeFileSync(resolvedOutput, `${JSON.stringify(manifest)}\n`, {
    mode: 0o600,
  });
  chmodSync(resolvedOutput, 0o600);
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      headCommit: manifest.headCommit,
      candidateFingerprint: manifest.candidateFingerprint,
    })}\n`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "remote_restore_candidate_manifest_failed"}\n`,
    );
    process.exitCode = 1;
  }
}
