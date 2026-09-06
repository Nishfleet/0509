#!/usr/bin/env node
/**
 * Issue #1401 — 7-day CTA field-extraction funnel backfill.
 *
 * Re-runs the current landing-page CTA extractor over stored HTML artifacts
 * (or reports `bailed: capture_failed` when the HTML is missing) and prints
 * the funnel bucket counts + dominant bail-out reason.
 *
 * This is a READ-ONLY diagnostic. It never writes to D1 or R2.
 *
 * Usage:
 *   # Offline: HTML files already downloaded into a directory
 *   node scripts/cta-field-funnel-backfill.mjs --html-dir /tmp/cta-backfill-1401/html
 *
 *   # With a captures JSON dump from:
 *   #   wrangler d1 execute 0509 --remote --json --command "SELECT id, html_artifact_key, ..."
 *   node scripts/cta-field-funnel-backfill.mjs \
 *     --captures /tmp/cta-backfill-1401/captures-7d.json \
 *     --html-dir /tmp/cta-backfill-1401/html
 *
 * The extractor is exercised via vitest's resolver (same path aliases the
 * app uses) by writing a tiny probe that imports
 * `~/lib/landing-page-signals.server` and printing JSON to a result file.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

function parseArgs(argv) {
  const out = { htmlDir: null, captures: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--html-dir") out.htmlDir = argv[++i];
    else if (arg === "--captures") out.captures = argv[++i];
    else if (arg === "--json") out.json = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/cta-field-funnel-backfill.mjs [--html-dir DIR] [--captures JSON] [--json]`);
      process.exit(0);
    }
  }
  return out;
}

function loadCaptures(path) {
  if (!path) return [];
  const raw = JSON.parse(readFileSync(path, "utf8"));
  // wrangler --json wraps results as [{ results: [...], success, meta }]
  if (Array.isArray(raw) && raw[0]?.results) return raw[0].results;
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.results)) return raw.results;
  throw new Error(`unrecognised captures JSON shape in ${path}`);
}

function collectHtmlFiles(htmlDir, captures) {
  const files = [];
  if (htmlDir && existsSync(htmlDir)) {
    for (const name of readdirSync(htmlDir)) {
      if (!name.endsWith(".html")) continue;
      files.push({
        id: name,
        path: join(htmlDir, name),
        key: name,
      });
    }
  }
  // Also surface captures whose HTML is missing so they count as
  // capture_failed (issue #1401 accept 3: partial by design).
  const byBase = new Map(files.map((f) => [basename(f.path), f]));
  const missing = [];
  for (const row of captures) {
    const key = row.html_artifact_key;
    if (!key) {
      missing.push({
        id: row.id ?? "unknown",
        reason: "capture_failed",
        detail: "html_artifact_key_null",
        oldCta: row.old_cta ?? row.ctaText ?? null,
      });
      continue;
    }
    const base = basename(key);
    if (!byBase.has(base)) {
      missing.push({
        id: row.id ?? base,
        reason: "capture_failed",
        detail: "html_file_missing",
        key,
        oldCta: row.old_cta ?? row.ctaText ?? null,
      });
    }
  }
  return { files, missing };
}

function runExtractor(files) {
  if (files.length === 0) return [];
  const work = mkdtempSync(join(tmpdir(), "cta-funnel-"));
  const manifest = join(work, "manifest.json");
  const resultsPath = join(work, "results.json");
  const probePath = join(ROOT, "tests", "cta-funnel-backfill.TEMP.test.ts");
  writeFileSync(
    manifest,
    JSON.stringify(
      files.map((f) => ({ id: f.id, path: f.path, key: f.key })),
      null,
      2,
    ),
  );
  writeFileSync(
    probePath,
    `import { readFileSync, writeFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { extractLandingPageSignals } from "~/lib/landing-page-signals.server";

describe("cta funnel backfill probe", () => {
  it("extracts every HTML file in the manifest", () => {
    const manifest = JSON.parse(readFileSync(${JSON.stringify(manifest)}, "utf8"));
    const rows = [];
    for (const entry of manifest) {
      const html = readFileSync(entry.path, "utf8");
      const signals = extractLandingPageSignals(html);
      rows.push({
        id: entry.id,
        key: entry.key,
        ctaText: signals.ctaText,
        stage: signals.ctaFunnel.stage,
        reasonCode: signals.ctaFunnel.reasonCode,
        bucket:
          signals.ctaFunnel.stage === "reached"
            ? "cta_field_reached"
            : "cta_field_bailed",
      });
    }
    writeFileSync(${JSON.stringify(resultsPath)}, JSON.stringify(rows, null, 2));
    expect(rows.length).toBe(manifest.length);
  });
});
`,
  );
  try {
    const run = spawnSync(
      "npx",
      ["vitest", "run", "tests/cta-funnel-backfill.TEMP.test.ts"],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: process.env,
      },
    );
    if (run.status !== 0) {
      process.stderr.write(run.stdout ?? "");
      process.stderr.write(run.stderr ?? "");
      throw new Error(`vitest probe exited ${run.status}`);
    }
    return JSON.parse(readFileSync(resultsPath, "utf8"));
  } finally {
    try {
      // Always remove the temp probe so it never lands in a commit.
      spawnSync("rm", ["-f", probePath], { cwd: ROOT });
    } catch {
      // ignore
    }
  }
}

function summarise(extracted, missing) {
  const buckets = {
    cta_field_reached: 0,
    cta_field_bailed: 0,
    capture_failed: 0,
  };
  const reasons = new Map();
  const flipped = [];

  for (const row of extracted) {
    if (row.bucket === "cta_field_reached") {
      buckets.cta_field_reached += 1;
    } else {
      buckets.cta_field_bailed += 1;
      const reason = row.reasonCode ?? "unknown";
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
  }
  for (const row of missing) {
    buckets.capture_failed += 1;
    reasons.set("capture_failed", (reasons.get("capture_failed") ?? 0) + 1);
  }

  // Dominant bail-out across bailed + capture_failed.
  let dominant = null;
  let dominantCount = 0;
  for (const [reason, count] of reasons.entries()) {
    if (count > dominantCount) {
      dominant = reason;
      dominantCount = count;
    }
  }

  return {
    totals: {
      extracted: extracted.length,
      missing: missing.length,
      ...buckets,
    },
    reasons: Object.fromEntries([...reasons.entries()].sort((a, b) => b[1] - a[1])),
    dominantBailReason: dominant,
    dominantBailCount: dominantCount,
    sampleReached: extracted
      .filter((r) => r.bucket === "cta_field_reached")
      .slice(0, 8)
      .map((r) => ({ id: r.id, ctaText: r.ctaText })),
    sampleBailed: extracted
      .filter((r) => r.bucket === "cta_field_bailed")
      .slice(0, 8)
      .map((r) => ({ id: r.id, reasonCode: r.reasonCode })),
    flipped,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.htmlDir && !args.captures) {
    console.error("Provide --html-dir and/or --captures.");
    process.exit(2);
  }
  const captures = loadCaptures(args.captures);
  const { files, missing } = collectHtmlFiles(args.htmlDir, captures);
  const extracted = runExtractor(files);
  const summary = summarise(extracted, missing);

  if (args.json) {
    process.stdout.write(JSON.stringify({ summary, extracted, missing }, null, 2));
    process.stdout.write("\n");
  } else {
    console.log("CTA field-extraction funnel backfill (issue #1401)");
    console.log(`  extracted:          ${summary.totals.extracted}`);
    console.log(`  capture_failed:     ${summary.totals.capture_failed}`);
    console.log(`  cta_field_reached:  ${summary.totals.cta_field_reached}`);
    console.log(`  cta_field_bailed:   ${summary.totals.cta_field_bailed}`);
    console.log(`  dominant bail:      ${summary.dominantBailReason} (${summary.dominantBailCount})`);
    console.log("  reason breakdown:");
    for (const [reason, count] of Object.entries(summary.reasons)) {
      console.log(`    ${reason}: ${count}`);
    }
    if (summary.sampleReached.length) {
      console.log("  sample reached:");
      for (const row of summary.sampleReached) {
        console.log(`    ${row.id} → ${JSON.stringify(row.ctaText)}`);
      }
    }
    if (summary.sampleBailed.length) {
      console.log("  sample bailed:");
      for (const row of summary.sampleBailed) {
        console.log(`    ${row.id} → ${row.reasonCode}`);
      }
    }
  }

  // Non-zero only when the extractor probe itself failed; a partial
  // backfill (missing HTML) is expected and exits 0.
  process.exit(0);
}

main();
