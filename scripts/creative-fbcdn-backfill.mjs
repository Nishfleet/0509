#!/usr/bin/env node
/**
 * Issue #2981 — fbcdn creative backfill audit for the content-hash R2 mirror.
 *
 * Step 1 of the R2-by-content-hash rollout (#2981): probe every stored fbcdn
 * creative URL, classify it resolved vs dead (the signed `oe=` parameter
 * expires ~4 days after capture), SHA-256 the live bytes, and emit the exact
 * `json_set` SQL + R2 key plan whose SQL can be applied with the deploys'
 * existing prod D1 path.
 *
 * READ-ONLY against D1 (takes a dump file, never queries D1 itself).
 * Touches fbcdn/CDN hosts with plain GETs and, with --r2, uploads the bytes
 * to the public artifacts bucket under `creatives/hash/<sha256>`.
 *
 * Usage:
 *   node scripts/creative-fbcdn-backfill.mjs --help
 *   # Dump: wrangler d1 execute 0509 --remote --json \
 *   #   --command "SELECT id, json_extract(raw_json,'\$.creativeImageUrl') AS url \
 *   #              FROM ad WHERE json_extract(raw_json,'\$.creativeImageUrl') LIKE '%fbcdn%'"
 *   node scripts/creative-fbcdn-backfill.mjs --d1-json rows.json [--json]
 *   node scripts/creative-fbcdn-backfill.mjs --d1-json rows.json --emit /tmp/hash-plan.json
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const HERE = dirname(pathToFileURL(import.meta.url).pathname);
const ROOT = resolve(HERE, "..");

function parseArgs(argv) {
  const out = { d1Json: null, emit: null, json: false, r2: false, timeoutMs: 12000 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--d1-json") out.d1Json = argv[++i];
    else if (argv[i] === "--emit") out.emit = argv[++i];
    else if (argv[i] === "--r2") out.r2 = true;
    else if (argv[i] === "--json") out.json = true;
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log(
        `Usage: node scripts/creative-fbcdn-backfill.mjs --d1-json <rows.json> [--emit <plan.json>] [--json]

--d1-json  JSON dump from wrangler d1 execute (rows: {id, url})
--emit     write the applied-plan JSON (SQL per ad id + R2 key + stats)
--r2       upload each resolved image to R2 under creatives/hash/<sha256> (requires authorized wrangler)
--json     print only the summary JSON`,
      );
      process.exit(0);
    }
  }
  if (!out.d1Json) {
    console.error("missing --d1-json (see --help)");
    process.exit(1);
  }
  return out;
}

function loadRows(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  // wrangler d1 execute --json prints an array of statement result envelopes.
  const statements = Array.isArray(raw) ? raw : [raw];
  const rows = [];
  for (const statement of statements) {
    const results = statement?.results ?? (Array.isArray(statement) ? statement : []);
    for (const row of results) {
      rows.push({ id: String(row.id ?? ""), url: typeof row.url === "string" ? row.url : null });
    }
  }
  return rows.filter((row) => row.id && row.url);
}

async function fetchCreative(url, timeoutMs) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "0509-bot/1.0 (+https://0509.io)",
        accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        referer: "https://www.facebook.com/",
      },
      redirect: "follow",
    });
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase().split(";")[0];
    if (!response.ok) {
      return { kind: "dead", status: response.status };
    }
    if (!contentType.startsWith("image/")) {
      return { kind: "dead", status: response.status, reason: "non-image content-type" };
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) {
      return { kind: "dead", status: response.status, reason: "empty body" };
    }
    const hash = createHash("sha256").update(bytes).digest("hex");
    return { kind: "resolved", hash, contentType, bytes };
  } catch (error) {
    return { kind: "dead", status: null, reason: `network: ${error?.message ?? "unknown"}` };
  }
}

async function r2Put(objectKey, bytes) {
  const { spawnSync } = await import("node:child_process");
  const tmp = await import("node:fs/promises");
  const path = `${await tmp.mkdtemp("/tmp/issue2981-")}/obj`;
  await tmp.writeFile(path, bytes);
  const result = spawnSync(
    "npx",
    ["wrangler", "r2", "object", "put", `0509-landing-page-artifacts/${objectKey}`, "--file", path],
    { cwd: ROOT, encoding: "utf8", timeout: 120000 },
  );
  await tmp.rm(path).catch(() => {});
  if (result.status !== 0) {
    throw new Error(`r2 put failed: ${(result.stderr || result.stdout || "").split("\n")[0]}`);
  }
}

const allowed = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rows = loadRows(args.d1Json);
  const resolved = [];
  const dead = [];
  for (const row of rows) {
    let parsed = null;
    try {
      parsed = new URL(row.url);
    } catch {
      /* treated as dead below */
    }
    if (!parsed || !parsed.hostname.endsWith(".fbcdn.net")) {
      dead.push({ ...row, reason: "unusable url" });
      continue;
    }
    const outcome = await fetchCreative(parsed.toString(), args.timeoutMs);
    if (outcome.kind === "dead") {
      dead.push({ id: row.id, reason: outcome.reason ?? `status ${outcome.status}` });
      continue;
    }
    resolved.push({
      id: row.id,
      url: parsed.toString(),
      urlHost: parsed.hostname,
      urlBucket: parsed.toString().slice(0, 512),
      hash: outcome.hash,
      contentType: outcome.contentType,
      bytes: outcome.bytes,
    });
  }

  let uploaded = null;
  if (args.r2) {
    let ok = 0;
    for (const item of resolved) {
      if (!allowed.has(item.contentType)) {
        continue;
      }
      try {
        await r2Put(`creatives/hash/${item.hash}`, item.bytes);
        item.r2Key = `creatives/hash/${item.hash}`;
        ok += 1;
      } catch {
        item.r2Key = null;
      }
    }
    uploaded = ok;
  }

  const summary = {
    total: rows.length,
    resolved: resolved.length,
    dead: dead.length,
    deadDetails: dead,
    r2Uploaded: uploaded,
    sqlPlanReady: args.emit ? true : false,
  };

  if (args.emit) {
    const plan = resolved.map((item) => ({
      id: item.id,
      hash: item.hash,
      contentType: item.contentType,
      r2Key: item.r2Key ?? null,
      // Applies via: wrangler d1 execute 0509 --remote --command "<sql>"
      // json_set touches ONLY $.creativeHash / $.creativeHashContentType.
      sql: item.r2Key
        ? `UPDATE ad SET raw_json = json_set(raw_json, '$.creativeHash', '${item.hash}', '$.creativeHashContentType', '${item.contentType}') WHERE id = '${item.id}';`
        : null,
    }));
    const { writeFileSync: writeFile } = await import("node:fs");
    writeFile(args.emit, JSON.stringify({ summary, plan }, null, 2) + "\n");
  }

  const { captureWorkerAcquired, ...rest } = summary;
  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`creative fbcdn backfill audit (issue #2981)`);
    console.log(`  total stored fbcdn-referencing ads: ${summary.total}`);
    console.log(`  resolved (still signed): ${summary.resolved}`);
    console.log(`  dead: ${summary.dead}`);
    for (const item of summary.deadDetails) {
      console.log(`    - ${item.id}: ${item.reason}`);
    }
    if (uploaded !== null) {
      console.log(`  uploaded to R2 by content hash: ${uploaded}`);
    }
  }
}

main();
