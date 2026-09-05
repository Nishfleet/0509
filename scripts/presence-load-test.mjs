#!/usr/bin/env node
/**
 * Deterministic Presence scheduler load simulation (no live network).
 * Validates batch selection, concurrency keys, and dedupe invariants at scale.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const SCENARIOS = [1000, 10_000];

function syncKey(workspaceId, sourceId, windowMs) {
  const bucket = Math.floor(Date.now() / windowMs);
  return createHash("sha256").update(`${workspaceId}:${sourceId}:${bucket}`).digest("hex").slice(0, 16);
}

function selectDueSources(sources, maxBatch) {
  return sources
    .filter((s) => s.nextSyncAt <= Date.now())
    .sort((a, b) => a.nextSyncAt - b.nextSyncAt)
    .slice(0, maxBatch);
}

function dedupeInsert(seen, item) {
  const key = item.externalId ?? item.urlHash;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}

for (const count of SCENARIOS) {
  const sources = Array.from({ length: count }, (_, i) => ({
    id: `src-${i}`,
    workspaceId: `ws-${i % 100}`,
    origin: `origin-${i % 50}`,
    nextSyncAt: Date.now() - (i % 5) * 1000,
  }));

  const batch = selectDueSources(sources, 20);
  assert.equal(batch.length, 20, `batch size for ${count}`);

  const keys = new Set(batch.map((s) => syncKey(s.workspaceId, s.id, 60_000)));
  assert.equal(keys.size, batch.length, `unique sync keys for ${count}`);

  const seen = new Set();
  let inserted = 0;
  for (const source of sources) {
    const item = { externalId: `item-${source.id}`, urlHash: `hash-${source.id}` };
    if (dedupeInsert(seen, item)) inserted += 1;
    if (dedupeInsert(seen, item)) {
      throw new Error(`duplicate accepted at ${count}`);
    }
  }
  assert.equal(inserted, count, `dedupe insert count for ${count}`);
}

console.log("presence load simulation: ok", { scenarios: SCENARIOS });
