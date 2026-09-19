#!/usr/bin/env node
// 0509#3576: fetch the export record the 6-hourly export-only job publishes at
// the fixed R2 key, and drop it where the deploy gate expects it.
//
// This is the ONLY thing in the deploy path that reads R2. It runs as its own
// step in deploy-production.yml, with Cloudflare credentials, immediately
// before `npm run deploy`. That placement is deliberate on two counts:
//
//   1. The gate that CONSUMES the record
//      (scripts/verify-remote-restore-evidence.mjs) stays credential-free, so
//      the verifier cannot be talked into fetching or fabricating what it
//      checks.
//   2. The unprivileged `prepare_remote_restore_evidence` job in
//      deploy-production.yml cannot read R2 at all, so it cannot use this
//      record to skip generating fresh restore evidence. Prepare is the one
//      place that must never take the cheap path.
//
// Failure is deliberately LOUD (non-zero exit). A deploy that cannot see the
// backup is the case the gate exists to catch; if this step swallowed the
// error, the verifier would report a missing record anyway, which reads as
// "the backup is stale" instead of "we could not reach R2".
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  BACKUP_BUCKET_NAME,
  BACKUP_EXPORT_RECORD_KEY,
  buildR2GetArgs,
} from "./d1-backup-command-args.mjs";
import { runCommandRedacted } from "./safe-command-output.mjs";

// The record is six small fields. Anything larger than this is not the record
// we published, and must not be written into the deploy workspace.
const MAX_RECORD_BYTES = 64 * 1024;
const GET_ATTEMPTS = 3;
const GET_RETRY_DELAY_MS = 5_000;

/** @param {string} name @returns {string | null} */
function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

/** @param {number} ms */
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** @param {string} outputPath */
async function main() {
  const outputPath = readArg("--output");
  if (!outputPath) throw new Error("backup_export_record_output_missing");
  const target = resolve(outputPath);
  // Same directory rule as every other private artifact in this repo: never
  // write outside test-results/, and never leave the file world-readable.
  if (!target.startsWith(`${resolve("test-results")}/`)) {
    throw new Error("backup_export_record_output_unexpected");
  }

  // Staged in a throwaway temp directory, then parsed and rewritten into place,
  // so a half-written or oversized download can never be mistaken for a
  // complete record.
  const stagingDirectory = mkdtempSync(
    join(tmpdir(), `0509-d1-export-record-get-${process.pid}-`),
  );
  const stagingPath = join(stagingDirectory, "export-record.json");

  try {
    let lastError = null;
    for (let attempt = 1; attempt <= GET_ATTEMPTS; attempt += 1) {
      try {
        rmSync(stagingPath, { force: true });
        await runCommandRedacted(
          "npx",
          buildR2GetArgs(
            BACKUP_BUCKET_NAME,
            BACKUP_EXPORT_RECORD_KEY,
            stagingPath,
          ),
        );
        const bytes = statSync(stagingPath).size;
        if (bytes < 2 || bytes > MAX_RECORD_BYTES) {
          throw new Error(`backup_export_record_size_invalid:${bytes}`);
        }
        const record = JSON.parse(readFileSync(stagingPath, "utf8"));
        if (
          !record ||
          typeof record !== "object" ||
          Array.isArray(record)
        ) {
          throw new Error("backup_export_record_shape_invalid");
        }
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, `${JSON.stringify(record)}\n`, {
          encoding: "utf8",
          mode: 0o600,
        });
        chmodSync(target, 0o600);
        process.stdout.write(
          `${JSON.stringify({
            ok: true,
            key: BACKUP_EXPORT_RECORD_KEY,
            output: outputPath,
            generatedAt:
              typeof record.generatedAt === "string"
                ? record.generatedAt
                : null,
          })}\n`,
        );
        return;
      } catch (error) {
        lastError = error;
        if (attempt < GET_ATTEMPTS) await sleep(GET_RETRY_DELAY_MS);
      }
    }
    throw new Error(
      `backup_export_record_unavailable:${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  } finally {
    rmSync(stagingDirectory, { recursive: true, force: true });
  }
}

await main();