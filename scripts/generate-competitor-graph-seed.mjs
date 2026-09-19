#!/usr/bin/env node
// Regenerates the curated-seed block inside migrations/0105_competitor_graph.sql
// from app/data/competitor-graph-curated.json (issue #1258).
//
// The JSON is the reviewable authoring surface (one entry per directed brand→
// peer edge, grouped by brand); the SQL file is what production D1 actually
// applies, so the two must never drift — tests/competitor-graph.test.ts
// applies the rendered migration to real sqlite and asserts the seeded ground
// truth end to end. Run this after editing the JSON:
//
//   node scripts/generate-competitor-graph-seed.mjs
//
// The script rewrites only the region between the BEGIN/END GENERATED SEED
// markers and exits non-zero when the data is invalid (self-edge, unknown
// category, malformed domain) so a bad edit fails loudly at author time.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const DATA_PATH = resolve(ROOT, "app/data/competitor-graph-curated.json");
const MIGRATION_PATH = resolve(ROOT, "migrations/0105_competitor_graph.sql");

const BEGIN = "-- BEGIN GENERATED SEED";
const END = "-- END GENERATED SEED";
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/u;

const doc = JSON.parse(readFileSync(DATA_PATH, "utf8"));
const categories = new Set(Object.keys(doc.categories ?? {}));
const verifiedAtEpoch = doc.verifiedAtEpoch;
if (!Number.isSafeInteger(verifiedAtEpoch) || verifiedAtEpoch <= 0) {
  throw new Error("competitor-graph-curated.json: verifiedAtEpoch must be a positive integer");
}

const rows = [];
const errors = [];
const seenEdges = new Set();

for (const [brandId, entry] of Object.entries(doc.graph ?? {})) {
  if (!DOMAIN_RE.test(brandId)) {
    errors.push(`brand_id ${JSON.stringify(brandId)} is not a domain`);
  }
  if (!categories.has(entry.category)) {
    errors.push(`brand_id ${brandId}: unknown category ${JSON.stringify(entry.category)}`);
  }
  for (const [peerId, confidence] of Object.entries(entry.peers ?? {})) {
    if (!DOMAIN_RE.test(peerId)) {
      errors.push(`${brandId}: peer_brand_id ${JSON.stringify(peerId)} is not a domain`);
    }
    if (peerId === brandId) {
      errors.push(`${brandId}: self-edge is not allowed`);
    }
    if (!Number.isSafeInteger(confidence) || confidence < 0 || confidence > 100) {
      errors.push(`${brandId} -> ${peerId}: confidence ${confidence} outside 0-100`);
    }
    const edgeKey = `${brandId} -> ${peerId} [${entry.category}]`;
    if (seenEdges.has(edgeKey)) {
      errors.push(`${edgeKey}: duplicate edge`);
    }
    seenEdges.add(edgeKey);
    rows.push({ brandId, peerId, categoryId: entry.category, confidence });
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`invalid: ${error}`);
  }
  process.exit(1);
}

rows.sort((a, b) =>
  a.brandId === b.brandId
    ? a.peerId.localeCompare(b.peerId)
    : a.brandId.localeCompare(b.brandId),
);

const esc = (value) => value.replaceAll("'", "''");
const lines = rows.map(
  (row) =>
    `INSERT OR IGNORE INTO competitor_graph (brand_id, peer_brand_id, category_id, source, confidence, last_verified_at)\n  VALUES ('${esc(row.brandId)}', '${esc(row.peerId)}', '${esc(row.categoryId)}', '${esc(doc.version)}', ${row.confidence}, ${verifiedAtEpoch});`,
);

const migration = readFileSync(MIGRATION_PATH, "utf8");
const beginAt = migration.indexOf(BEGIN);
const endAt = migration.indexOf(END);
if (beginAt === -1 || endAt === -1 || endAt < beginAt) {
  throw new Error(`${MIGRATION_PATH}: missing ${BEGIN} / ${END} markers`);
}

const next =
  `${migration.slice(0, beginAt + BEGIN.length)}\n` +
  `${lines.join("\n")}\n` +
  `${END}${migration.slice(endAt + END.length)}`;

if (next !== migration) {
  writeFileSync(MIGRATION_PATH, next);
}
console.log(`competitor_graph seed: ${rows.length} edges across ${Object.keys(doc.graph).length} brands${next === migration ? " (unchanged)" : ""}`);
