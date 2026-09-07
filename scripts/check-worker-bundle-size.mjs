#!/usr/bin/env node
// Fails when the built Worker bundle's uncompressed upload size exceeds the
// Cloudflare limit. Cloudflare removed the compressed-size cap on 2026-09-04;
// only the uncompressed 64 MiB limit applies now (see the changelog post
// https://developers.cloudflare.com/changelog/post/2026-09-04-increased-worker-size-limit/).
// This guard runs `wrangler deploy --dry-run` and asserts the reported
// "Total Upload" (the uncompressed bundle size) is at most 64 MiB, so a
// bundle that would be rejected at deploy time is caught in CI instead.
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const MAX_UPLOAD_KIB = 64 * 1024; // 64 MiB, uncompressed.

// wrangler deploy --dry-run prints a line like:
//   Total Upload: 8561.01 KiB / gzip: 1863.03 KiB
// The value before " KiB" is the uncompressed bundle size in KiB.
/**
 * @param {string} output
 * @returns {number}
 */
export function parseTotalUploadKiB(output) {
  const match = output.match(/Total Upload:\s*([\d.]+)\s*KiB/);
  if (!match) {
    throw new Error(
      "could not find 'Total Upload' (in KiB) in wrangler dry-run output",
    );
  }
  return Number(match[1]);
}

// Only run the check when executed directly, not when imported for tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = spawnSync("wrangler", ["deploy", "--dry-run"], {
    cwd: root,
    env: {
      ...process.env,
      CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
    },
    encoding: "utf8",
  });

  if (result.error) {
    console.error(`bundle size check could not run: ${result.error.message}`);
    process.exit(1);
  }

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

  if (result.status !== 0) {
    console.error(output.trim());
    console.error("bundle size check failed: wrangler dry-run exited non-zero.");
    process.exit(1);
  }

  let uploadKiB;
  try {
    uploadKiB = parseTotalUploadKiB(output);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const uploadMiB = uploadKiB / 1024;
  if (uploadKiB > MAX_UPLOAD_KIB) {
    console.error(
      `bundle size check failed: Total Upload ${uploadMiB.toFixed(2)} MiB exceeds the 64 MiB uncompressed limit.`,
    );
    process.exit(1);
  }

  console.log(
    `bundle size check passed: Total Upload ${uploadMiB.toFixed(2)} MiB (≤ 64 MiB uncompressed).`,
  );
}
