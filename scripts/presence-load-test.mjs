#!/usr/bin/env node
/**
 * Deterministic Presence scheduler load simulation (no live network).
 * Validates batch selection, concurrency keys, and dedupe invariants at scale.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const SCENARIOS = [1000, 10_000];

/**
 * Watchlist scheduling ceiling (0509#2990).
 *
 * Prod constants this model reads:
 * - MONITORING_FANOUT_MAX_INFLIGHT (wrangler.jsonc pins 8; env overrides for what-if runs)
 * - paid cadence: agency/starter scheduled scans run every 3 hours (scout: 6h, free: weekly)
 * - worst-case per-run duration: a workflow scan step is hard-capped at 30 minutes
 *   (MONITORING_WORKFLOW_SCAN_TIMEOUT_MS, see app/lib/monitoring-fanout.server.ts)
 *
 * The ceiling is the number of active watchlists whose worst-case drain fits the
 * cadence window. `slipCeiling` adds the published allowance of one slipped
 * cadence before an alert fires (scripts/monitoring-fanout-canary.mjs --step cadence).
 */
const WATCHLIST_SCAN_TIMEOUT_MINUTES = 30;
const CADENCE_MINUTES_DEFAULT = 180;
const inflightEnv = process.env.MONITORING_FANOUT_MAX_INFLIGHT?.trim();
const cadenceEnv = process.env.MONITORING_CADENCE_MINUTES?.trim();
const maxInflight = Math.max(1, Number.parseInt(inflightEnv ?? "8", 10) || 8);
const cadenceMinutes = Math.max(1, Number.parseInt(cadenceEnv ?? "", 10) || CADENCE_MINUTES_DEFAULT);
/** @param {number} watchlists */
function drainMinutes(watchlists) {
  return Math.ceil(watchlists / maxInflight) * WATCHLIST_SCAN_TIMEOUT_MINUTES;
}
const keepUpCeiling = Math.floor((maxInflight * cadenceMinutes) / WATCHLIST_SCAN_TIMEOUT_MINUTES);
const slipCeiling = Math.floor((maxInflight * 2 * cadenceMinutes) / WATCHLIST_SCAN_TIMEOUT_MINUTES);
assert.ok(drainMinutes(keepUpCeiling) <= cadenceMinutes, "keep-up ceiling must fit one cadence");
assert.ok(
  drainMinutes(keepUpCeiling + 1) > cadenceMinutes,
  "keep-up ceiling +1 must overflow one cadence",
);
assert.ok(
  drainMinutes(slipCeiling) <= 2 * cadenceMinutes,
  "slip ceiling must fit cadence + 1 slipped cadence",
);
console.log(
  `watchlist ceiling (inflight=${maxInflight}, cadence=${cadenceMinutes}min, worst-run=${WATCHLIST_SCAN_TIMEOUT_MINUTES}min):`,
);
console.log(`  keeps pace at up to ${keepUpCeiling} watchlists fleet-wide`);
console.log(`  slips <=1 cadence up to ${slipCeiling} watchlists fleet-wide (canary alert threshold)`);
console.log(`  > ${slipCeiling} watchlists: schedule falls more than one cadence behind`);

/**
 * Agency split cadence (WP-37): only a workspace's first PRIORITY_SCAN_SLOTS
 * watchlists run on every paid-cadence tick; ranks beyond that run only on
 * 6h-aligned ticks (plan-entitlements.ts `priorityScanSlots`). Per 6h window a
 * fully-loaded Agency workspace therefore demands
 * ticksPer6h*min(W,25) + max(0,W-25) runs — more than a flat cadence implies.
 */
const PRIORITY_SCAN_SLOTS = 25;
const AGENCY_WATCHLIST_LIMIT = 75;
const ticksPer6hWindow = Math.max(1, Math.floor(360 / cadenceMinutes));
const capacityPer6h = Math.floor((maxInflight * 360) / WATCHLIST_SCAN_TIMEOUT_MINUTES);
/** @param {number} watchlists */
function agencyDemandPer6h(watchlists) {
  return (
    ticksPer6hWindow * Math.min(watchlists, PRIORITY_SCAN_SLOTS) +
    Math.max(0, watchlists - PRIORITY_SCAN_SLOTS)
  );
}
let agencyKeepUpCeiling = 0;
while (agencyDemandPer6h(agencyKeepUpCeiling + 1) <= capacityPer6h) {
  agencyKeepUpCeiling += 1;
}
assert.ok(agencyDemandPer6h(agencyKeepUpCeiling) <= capacityPer6h);
assert.ok(agencyDemandPer6h(agencyKeepUpCeiling + 1) > capacityPer6h);
console.log(
  `agency workspace (priorityScanSlots=${PRIORITY_SCAN_SLOTS}; ranks beyond run on 6h-aligned ticks only):`,
);
console.log(`  keeps pace at up to ${agencyKeepUpCeiling} watchlists/workspace worst-case`);
console.log(
  `  the promised ${AGENCY_WATCHLIST_LIMIT} demands ${agencyDemandPer6h(AGENCY_WATCHLIST_LIMIT)} runs/6h vs ${capacityPer6h} worst-case capacity`,
);

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
