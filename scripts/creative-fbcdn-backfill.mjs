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
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

/** @param {string[]} argv */
export function parseArgs(argv) {
  const out = {
    d1Json: /** @type {string | null} */ (null),
    emit: /** @type {string | null} */ (null),
    json: false,
    r2: false,
    timeoutMs: 12000,
  };
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

/** @param {string} path */
export function loadRows(path) {
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

/**
 * @param {string} url @param {number} timeoutMs @param {number} [hops]
 * @returns {Promise<{ kind: 'resolved', hash: string, contentType: string, bytes: Uint8Array } | { kind: 'dead', status: number, reason?: string } | { kind: 'transient', status: number | null, reason: string }>}
 */
async function fetchCreative(url, timeoutMs, hops = 0) {
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
      // Issue #2981: follow redirects manually and re-apply the fbcdn host gate
      // on EVERY hop, exactly as the Worker serve path does. `redirect: "follow"`
      // would let the probe (and, under --r2, an upload to the public bucket)
      // end up on an unvetted host.
      redirect: "manual",
    });
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase().split(";")[0];
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return { kind: "transient", status: null, reason: "redirect without location" };
      }
      let next;
      try {
        next = new URL(location, url).toString();
      } catch {
        return { kind: "transient", status: null, reason: "unparseable redirect" };
      }
      const nextHops = hops + 1;
      if (nextHops > 5 || !isFbcdnCreativeUrl(new URL(next))) {
        return { kind: "transient", status: null, reason: "redirect left fbcdn" };
      }
      clearTimeout(timer);
      return fetchCreative(next, timeoutMs, nextHops);
    }
    if (!response.ok) {
      // A real 4xx is a dead signature; a 5xx is a wobble and must not be
      // reported as a dead creative (the serve path makes the same split).
      if (response.status >= 400 && response.status < 500) {
        return { kind: "dead", status: response.status };
      }
      return { kind: "transient", status: response.status, reason: `status ${response.status}` };
    }
    if (!contentType.startsWith("image/")) {
      return { kind: "dead", status: response.status, reason: "non-image content-type" };
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) {
      return { kind: "dead", status: response.status, reason: "empty body" };
    }
    clearTimeout(timer);
    const hash = createHash("sha256").update(bytes).digest("hex");
    return { kind: "resolved", hash, contentType, bytes };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return { kind: "transient", status: null, reason: `network: ${message}` };
  }
}

/** @param {string} objectKey @param {Uint8Array} bytes */
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
    const detail =
      result.error?.message ??
      (result.stderr || result.stdout || "spawnSync produced no output").split("\n")[0];
    throw new Error(`r2 put failed (status ${result.status}): ${detail}`);
  }
}

export const allowed = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

/**
 * True when a value is safe to interpolate into the emitted SQL plan. The plan
 * is run against prod D1 by an operator, so anything outside a conservative
 * id / MIME-type shape is refused rather than escaped by hand.
 */
/** @param {unknown} value */
export function isSafePlanValue(value) {
  return typeof value === "string" && /^[A-Za-z0-9._:/-]{1,128}$/.test(value);
}

/**
 * True when a parsed URL is a fetchable fbcdn creative URL. Exported so the
 * classification is testable without touching the network — the whole point of
 * the audit is the resolved-vs-dead split, and a hardcoded gate cannot be
 * pinned by a test (issue #2981).
 */
/** @param {URL | null} parsed @returns {parsed is URL} */
export function isFbcdnCreativeUrl(parsed) {
  return parsed !== null && typeof parsed?.hostname === "string" && parsed.hostname.endsWith(".fbcdn.net");
}

/**
 * Classify one `{id, url}` row into resolved / dead. Pure apart from the
 * injected `fetchCreative` probe, so tests can drive both branches with a
 * stub and assert the reported dead count the ticket asks for.
 */
/** @param {{ id: string, url: string | null }} row @param {{ fetchCreative?: typeof fetchCreative, timeoutMs?: number }} [options]
 * @returns {Promise<{ kind: 'resolved', detail: { id: string, url: string, urlHost: string, urlBucket: string, hash: string, contentType: string, bytes: Uint8Array } } | { kind: 'dead', detail: { id: string, reason: string } } | { kind: 'unusable', detail: { id: string, url: string | null, reason: string } } | { kind: 'transient', detail: { id: string, reason: string } }>}
 */
export async function classifyRow(row, options = {}) {
  const probe = options.fetchCreative ?? fetchCreative;
  const timeoutMs = options.timeoutMs ?? 12000;
  /** @type {URL | null} */
  let parsed = null;
  try {
    parsed = new URL(/** @type {string} */ (row.url));
  } catch {
    /* treated as unusable below */
  }
  if (!parsed || !isFbcdnCreativeUrl(parsed)) {
    // Not a dead creative — a row the audit cannot judge. Kept in its own
    // bucket so the reported dead count is not inflated by unusable URLs.
    return { kind: "unusable", detail: { ...row, reason: "unusable url" } };
  }
  const outcome = await probe(parsed.toString(), timeoutMs);
  if (outcome.kind === "dead") {
    return {
      kind: "dead",
      detail: { id: row.id, reason: outcome.reason ?? `status ${outcome.status}` },
    };
  }
  if (outcome.kind === "transient") {
    // A 5xx, timeout or network error is not a dead creative. Counting it as
    // dead would report a false death spike off one bad afternoon.
    return { kind: "transient", detail: { id: row.id, reason: outcome.reason } };
  }
  return {
    kind: "resolved",
    detail: {
      id: row.id,
      url: parsed.toString(),
      urlHost: parsed.hostname,
      urlBucket: parsed.toString().slice(0, 512),
      hash: outcome.hash,
      contentType: outcome.contentType,
      bytes: outcome.bytes,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.d1Json) {
    throw new Error("missing --d1-json");
  }
  const rows = loadRows(args.d1Json);
  // Typed so the heterogeneous detail unions do not infect the R2 upload loop.
  /** @type {{ id: string, url: string, urlHost: string, urlBucket: string, hash: string, contentType: string, bytes: Uint8Array, r2Key?: string | null }[]} */
  const resolved = [];
  const dead = [];
  const unusable = [];
  const transient = [];
  for (const row of rows) {
    const classified = await classifyRow(row, { timeoutMs: args.timeoutMs });
    if (classified.kind === "resolved") {
      resolved.push(classified.detail);
    } else if (classified.kind === "dead") {
      dead.push(classified.detail);
    } else if (classified.kind === "unusable") {
      unusable.push(classified.detail);
    } else {
      transient.push(classified.detail);
    }
  }

  let uploaded = null;
  let skippedMediaType = 0;
  if (args.r2) {
    let ok = 0;
    for (const item of resolved) {
      if (!allowed.has(item.contentType)) {
        // The allow-list is a security gate, so its rejects get a number.
        skippedMediaType += 1;
        continue;
      }
      try {
        await r2Put(`creatives/hash/${item.hash}`, item.bytes);
        item.r2Key = `creatives/hash/${item.hash}`;
        ok += 1;
      } catch (err) {
        // A failed upload is named, not swallowed: the summary's r2Uploaded
        // alone cannot tell a permission failure from a skipped item.
        console.error(
          `r2 put failed for ad ${item.id} (hash ${item.hash.slice(0, 12)}…): ${err?.message ?? err}`,
        );
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
    // Reported separately so `dead` is only genuinely dead creatives: a
    // non-fbcdn or unparseable URL is a row we cannot judge, and a 5xx or
    // timeout is a wobble, not a death.
    unusable: unusable.length,
    unusableDetails: unusable,
    transient: transient.length,
    transientDetails: transient,
    r2Uploaded: uploaded,
    r2SkippedMediaType: args.r2 ? skippedMediaType : null,
    sqlPlanReady: args.emit ? true : false,
  };

  if (args.emit) {
    const plan = resolved.map((item) => {
      // The plan is run against prod D1 by an operator, so the id and content
      // type are validated and escaped rather than pasted raw: both arrive from
      // a dump and a remote header, and a `'` in either would break or inject
      // into the emitted statement.
      const safeId = isSafePlanValue(item.id) ? item.id : null;
      const safeContentType = isSafePlanValue(item.contentType) ? item.contentType : null;
      return {
        id: item.id,
        hash: item.hash,
        contentType: item.contentType,
        r2Key: item.r2Key ?? null,
        // Applies via: wrangler d1 execute 0509 --remote --command "<sql>"
        // json_set touches ONLY $.creativeHash / $.creativeHashContentType.
        sql:
          item.r2Key && safeId && safeContentType
            ? `UPDATE ad SET raw_json = json_set(raw_json, '$.creativeHash', '${item.hash}', '$.creativeHashContentType', '${safeContentType}') WHERE id = '${safeId}';`
            : null,
      };
    });
    const { writeFileSync: writeFile } = await import("node:fs");
    writeFile(args.emit, JSON.stringify({ summary, plan }, null, 2) + "\n");
  }

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`creative fbcdn backfill audit (issue #2981)`);
    console.log(`  total stored fbcdn-referencing ads: ${summary.total}`);
    console.log(`  resolved (still signed): ${summary.resolved}`);
    console.log(`  dead (expired or 4xx): ${summary.dead}`);
    for (const item of summary.deadDetails) {
      console.log(`    - ${item.id}: ${item.reason}`);
    }
    console.log(`  unusable url (not judgeable): ${summary.unusable}`);
    console.log(`  transient (5xx/timeout, retry later): ${summary.transient}`);
    if (uploaded !== null) {
      console.log(`  uploaded to R2 by content hash: ${uploaded}`);
      console.log(`  skipped (media type not allow-listed): ${summary.r2SkippedMediaType}`);
    }
  }
  return summary;
}

// Only run the CLI when invoked directly; importing for tests must not probe
// the network or read argv.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
