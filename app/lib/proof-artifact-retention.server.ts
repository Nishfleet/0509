import { execute, queryAll } from "~/lib/data/d1.server";
import type { AppEnv } from "~/lib/env.server";
import type { LandingPageSnapshotData } from "~/lib/types";

/**
 * R2 proof artifacts are deliberately addressed by one producer-owned key
 * shape. Do not broaden this parser to accept a key supplied by a client.
 */
const ARTIFACT_KEY_PATTERN =
  /^landing-pages\/\d{4}-\d{2}-\d{2}\/[0-9a-f]{32}\.(html|jpeg)$/u;
const OWNER_ID_PATTERN = /^[^\u0000-\u001f\u007f]{1,256}$/u;
const MAX_DELETE_KEYS = 20;

export type ProofArtifactKind = "html" | "screenshot";
export type ProofArtifactReferenceState = "unreferenced" | "referenced" | "shared";

export interface ProofArtifactKey {
  key: string;
  kind: ProofArtifactKind;
}

export interface ProofArtifactInventory {
  key: string;
  kind: ProofArtifactKind;
  referenceState: ProofArtifactReferenceState;
  referenceCount: number;
  ownerCount: number;
  ownerHasReference: boolean;
  landingPageSnapshotReferences: number;
  proofCaptureReferences: number;
}

export interface ProofArtifactDeleteResult {
  key: string;
  ok: boolean;
  outcome:
    | "deleted"
    | "missing"
    | "denied"
    | "shared_reference"
    | "revoked_shared"
    | "unreferenced"
    | "invalid_key"
    | "r2_failed"
    | "d1_failed";
  r2: "deleted" | "missing" | "not_attempted" | "failed";
  d1: "updated" | "failed" | "not_updated";
}

interface ArtifactReferenceAggregate {
  reference_count: number | string | null;
  owner_count: number | string | null;
  owner_match_count: number | string | null;
  landing_page_snapshot_references: number | string | null;
  proof_capture_references: number | string | null;
}

function ownerIdIsSafe(ownerId: unknown): ownerId is string {
  return typeof ownerId === "string" && OWNER_ID_PATTERN.test(ownerId);
}

function asNonNegativeInteger(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

/** Return the only R2 key families produced by landing-page/proof capture. */
export function parseProofArtifactKey(value: unknown): ProofArtifactKey | null {
  if (typeof value !== "string") return null;
  const match = ARTIFACT_KEY_PATTERN.exec(value);
  if (!match) return null;
  return { key: value, kind: match[1] === "html" ? "html" : "screenshot" };
}

export function isKnownProofArtifactKey(value: unknown): value is string {
  return parseProofArtifactKey(value) !== null;
}

function referenceState(referenceCount: number, ownerCount: number): ProofArtifactReferenceState {
  if (referenceCount === 0) return "unreferenced";
  return ownerCount > 1 ? "shared" : "referenced";
}

/**
 * Build ownership/reference evidence from D1. User ids are used only in a
 * bound predicate and are never returned, so callers cannot project another
 * workspace's identity from this helper.
 */
export async function getProofArtifactInventory(
  env: AppEnv,
  key: unknown,
  ownerId?: unknown,
): Promise<ProofArtifactInventory | null> {
  const parsed = parseProofArtifactKey(key);
  if (!parsed || (ownerId !== undefined && !ownerIdIsSafe(ownerId))) return null;

  const owner = ownerIdIsSafe(ownerId) ? ownerId : "";
  const proofColumn = parsed.kind === "html" ? "html_artifact_key" : "screenshot_artifact_key";
  const rows = await queryAll<ArtifactReferenceAggregate>(
    env,
    `
      SELECT
        COUNT(*) AS reference_count,
        COUNT(DISTINCT owner_id) AS owner_count,
        MAX(CASE WHEN owner_id = ? THEN 1 ELSE 0 END) AS owner_match_count,
        SUM(CASE WHEN source = 'landing_page_snapshot' THEN 1 ELSE 0 END) AS landing_page_snapshot_references,
        SUM(CASE WHEN source = 'proof_capture' THEN 1 ELSE 0 END) AS proof_capture_references
      FROM (
        SELECT watchlist.user_id AS owner_id, 'landing_page_snapshot' AS source
        FROM landing_page_snapshot
        INNER JOIN ad_observation
          ON ad_observation.landing_page_snapshot_id = landing_page_snapshot.id
        INNER JOIN watchlist_run
          ON watchlist_run.id = ad_observation.watchlist_run_id
        INNER JOIN watchlist
          ON watchlist.id = watchlist_run.watchlist_id
        WHERE landing_page_snapshot.artifact_key = ?
        UNION ALL
        SELECT watchlist.user_id AS owner_id, 'proof_capture' AS source
        FROM proof_capture
        INNER JOIN proof_target
          ON proof_target.id = proof_capture.proof_target_id
        INNER JOIN watchlist
          ON watchlist.id = proof_target.watchlist_id
        WHERE proof_capture.${proofColumn} = ?
      ) AS references_for_key
    `,
    owner,
    parsed.key,
    parsed.key,
  );

  const row = rows[0];
  const snapshotReferences = asNonNegativeInteger(row?.landing_page_snapshot_references);
  const captureReferences = asNonNegativeInteger(row?.proof_capture_references);
  const referenceCount = asNonNegativeInteger(row?.reference_count);
  const ownerCount = asNonNegativeInteger(row?.owner_count);
  const ownerHasReference =
    asNonNegativeInteger(row?.owner_match_count) > 0;

  return {
    key: parsed.key,
    kind: parsed.kind,
    referenceState: referenceState(referenceCount, ownerCount),
    referenceCount,
    ownerCount,
    ownerHasReference,
    landingPageSnapshotReferences: snapshotReferences,
    proofCaptureReferences: captureReferences,
  };
}

async function inventoryForOwner(env: AppEnv, ownerId: unknown, key: unknown) {
  if (!ownerIdIsSafe(ownerId)) return null;
  return getProofArtifactInventory(env, key, ownerId);
}

/** Head an artifact only after D1 proves that the caller owns a reference. */
export async function headProofArtifactForOwner(
  env: AppEnv,
  ownerId: unknown,
  key: unknown,
): Promise<R2Object | null> {
  const inventory = await inventoryForOwner(env, ownerId, key);
  if (!inventory?.ownerHasReference || !env.LANDING_PAGE_ARTIFACTS) return null;
  return env.LANDING_PAGE_ARTIFACTS.head(inventory.key);
}

/** Retrieve an artifact only after D1 proves that the caller owns a reference. */
export async function getProofArtifactForOwner(
  env: AppEnv,
  ownerId: unknown,
  key: unknown,
): Promise<R2ObjectBody | null> {
  const inventory = await inventoryForOwner(env, ownerId, key);
  if (!inventory?.ownerHasReference || !env.LANDING_PAGE_ARTIFACTS) return null;
  return env.LANDING_PAGE_ARTIFACTS.get(inventory.key);
}

async function deleteOneProofArtifact(
  env: AppEnv,
  ownerId: unknown,
  key: unknown,
): Promise<ProofArtifactDeleteResult> {
  const parsed = parseProofArtifactKey(key);
  const normalizedKey = typeof key === "string" ? key : "";
  if (!parsed) {
    return { key: normalizedKey, ok: false, outcome: "invalid_key", r2: "not_attempted", d1: "not_updated" };
  }
  const inventory = await inventoryForOwner(env, ownerId, parsed.key);
  if (!inventory) {
    return { key: parsed.key, ok: false, outcome: "denied", r2: "not_attempted", d1: "not_updated" };
  }
  if (inventory.referenceState === "unreferenced") {
    return { key: parsed.key, ok: false, outcome: "unreferenced", r2: "not_attempted", d1: "not_updated" };
  }
  if (!inventory.ownerHasReference) {
    return { key: parsed.key, ok: false, outcome: "denied", r2: "not_attempted", d1: "not_updated" };
  }
  if (inventory.landingPageSnapshotReferences > 0) {
    return { key: parsed.key, ok: false, outcome: "shared_reference", r2: "not_attempted", d1: "not_updated" };
  }
  if (inventory.referenceState === "shared") {
    try {
      const changed = await clearOwnerProofArtifactReference(env, ownerId, parsed);
      return changed > 0
        ? { key: parsed.key, ok: true, outcome: "revoked_shared", r2: "not_attempted", d1: "updated" }
        : { key: parsed.key, ok: false, outcome: "d1_failed", r2: "not_attempted", d1: "failed" };
    } catch {
      return { key: parsed.key, ok: false, outcome: "d1_failed", r2: "not_attempted", d1: "failed" };
    }
  }
  if (!env.LANDING_PAGE_ARTIFACTS) {
    return { key: parsed.key, ok: false, outcome: "r2_failed", r2: "failed", d1: "not_updated" };
  }

  try {
    const existing = await env.LANDING_PAGE_ARTIFACTS.head(parsed.key);
    const r2 = existing ? "deleted" : "missing";
    if (existing) await env.LANDING_PAGE_ARTIFACTS.delete(parsed.key);
    try {
      const changed = await clearOwnerProofArtifactReference(env, ownerId, parsed);
      return changed > 0
        ? { key: parsed.key, ok: true, outcome: r2, r2, d1: "updated" }
        : { key: parsed.key, ok: false, outcome: "d1_failed", r2, d1: "failed" };
    } catch {
      return { key: parsed.key, ok: false, outcome: "d1_failed", r2, d1: "failed" };
    }
  } catch {
    return { key: parsed.key, ok: false, outcome: "r2_failed", r2: "failed", d1: "not_updated" };
  }
}

async function clearOwnerProofArtifactReference(
  env: AppEnv,
  ownerId: unknown,
  parsed: ProofArtifactKey,
) {
  if (!ownerIdIsSafe(ownerId)) return 0;
  const column = parsed.kind === "html" ? "html_artifact_key" : "screenshot_artifact_key";
  const metadataPath = parsed.kind === "html" ? "$.htmlArtifactKey" : "$.screenshotArtifactKey";
  const result = await execute(
    env,
    `
      UPDATE proof_capture
      SET ${column} = NULL,
          capture_metadata_json = CASE
            WHEN json_valid(capture_metadata_json)
            THEN json_remove(capture_metadata_json, '${metadataPath}')
            ELSE capture_metadata_json
          END,
          updated_at = ?
      WHERE ${column} = ?
        AND EXISTS (
          SELECT 1
          FROM proof_target
          INNER JOIN watchlist ON watchlist.id = proof_target.watchlist_id
          WHERE proof_target.id = proof_capture.proof_target_id
            AND watchlist.user_id = ?
        )
    `,
    new Date().toISOString(),
    parsed.key,
    ownerId,
  );
  return Number(result.meta?.changes ?? 0);
}

/** Delete at most 20 keys, preserving explicit per-key R2/D1 truth. */
export async function deleteProofArtifacts(
  env: AppEnv,
  ownerId: unknown,
  keys: readonly unknown[],
): Promise<ProofArtifactDeleteResult[]> {
  if (!Array.isArray(keys) || keys.length > MAX_DELETE_KEYS) {
    throw new Error("proof_artifact_delete_bound_exceeded");
  }
  const seen = new Set<string>();
  const results: ProofArtifactDeleteResult[] = [];
  for (const key of keys) {
    const normalized = typeof key === "string" ? key : "";
    if (seen.has(normalized)) {
      results.push({ key: normalized, ok: false, outcome: "invalid_key", r2: "not_attempted", d1: "not_updated" });
      continue;
    }
    seen.add(normalized);
    results.push(await deleteOneProofArtifact(env, ownerId, key));
  }
  return results;
}

/**
 * Delete/revoke only one proven capture's references. This is narrower than
 * owner deletion and prevents a content-addressed canary object from removing
 * an older same-owner proof that happens to share the key.
 */
export async function deleteProofArtifactsForCapture(
  env: AppEnv,
  ownerId: unknown,
  proofCaptureId: unknown,
  keys: readonly unknown[],
): Promise<ProofArtifactDeleteResult[]> {
  if (!ownerIdIsSafe(ownerId) || typeof proofCaptureId !== "string" || !ownerIdIsSafe(proofCaptureId)) {
    throw new Error("proof_artifact_capture_scope_invalid");
  }
  if (!Array.isArray(keys) || keys.length > MAX_DELETE_KEYS) throw new Error("proof_artifact_delete_bound_exceeded");
  const results: ProofArtifactDeleteResult[] = [];
  for (const key of new Set(keys)) {
    const parsed = parseProofArtifactKey(key);
    if (!parsed) {
      results.push({ key: typeof key === "string" ? key : "", ok: false, outcome: "invalid_key", r2: "not_attempted", d1: "not_updated" });
      continue;
    }
    const inventory = await inventoryForOwner(env, ownerId, parsed.key);
    if (!inventory?.ownerHasReference) {
      results.push({ key: parsed.key, ok: false, outcome: "denied", r2: "not_attempted", d1: "not_updated" });
      continue;
    }
    try {
      if (await artifactReferencedOutsideCapture(env, proofCaptureId, parsed.key)) {
        const changed = await clearCaptureProofArtifactReference(env, ownerId, proofCaptureId, parsed);
        results.push(changed === 1
          ? { key: parsed.key, ok: true, outcome: "revoked_shared", r2: "not_attempted", d1: "updated" }
          : { key: parsed.key, ok: false, outcome: "d1_failed", r2: "not_attempted", d1: "failed" });
        continue;
      }
      if (!env.LANDING_PAGE_ARTIFACTS) throw new Error("r2_missing");
      const existing = await env.LANDING_PAGE_ARTIFACTS.head(parsed.key);
      const r2 = existing ? "deleted" : "missing";
      if (existing) await env.LANDING_PAGE_ARTIFACTS.delete(parsed.key);
      const changed = await clearCaptureProofArtifactReference(env, ownerId, proofCaptureId, parsed);
      results.push(changed === 1
        ? { key: parsed.key, ok: true, outcome: r2, r2, d1: "updated" }
        : { key: parsed.key, ok: false, outcome: "d1_failed", r2, d1: "failed" });
    } catch {
      results.push({ key: parsed.key, ok: false, outcome: "r2_failed", r2: "failed", d1: "not_updated" });
    }
  }
  return results;
}

async function artifactReferencedOutsideCapture(env: AppEnv, proofCaptureId: string, key: string) {
  const rows = await queryAll<{ external_references: number | string | null }>(
    env,
    `
      SELECT (
        SELECT COUNT(*) FROM proof_capture AS other
        WHERE other.id <> ?
          AND (other.html_artifact_key = ? OR other.screenshot_artifact_key = ?)
      ) + (
        SELECT COUNT(*) FROM landing_page_snapshot
        WHERE artifact_key = ?
          OR (json_valid(metadata_json) AND json_extract(metadata_json, '$.htmlArtifactKey') = ?)
          OR (json_valid(metadata_json) AND json_extract(metadata_json, '$.screenshotArtifactKey') = ?)
      ) + (
        SELECT COUNT(*) FROM ad
        WHERE json_valid(raw_json) AND (
          json_extract(raw_json, '$.landingPage.artifactKey') = ?
          OR json_extract(raw_json, '$.landingPage.metadata.htmlArtifactKey') = ?
          OR json_extract(raw_json, '$.landingPage.metadata.screenshotArtifactKey') = ?
        )
      ) AS external_references
    `,
    proofCaptureId,
    key,
    key,
    key,
    key,
    key,
    key,
    key,
    key,
  );
  return Number(rows[0]?.external_references ?? 0) > 0;
}

async function clearCaptureProofArtifactReference(
  env: AppEnv,
  ownerId: string,
  proofCaptureId: string,
  parsed: ProofArtifactKey,
) {
  const column = parsed.kind === "html" ? "html_artifact_key" : "screenshot_artifact_key";
  const metadataPath = parsed.kind === "html" ? "$.htmlArtifactKey" : "$.screenshotArtifactKey";
  const result = await execute(
    env,
    `
      UPDATE proof_capture
      SET ${column} = NULL,
          capture_metadata_json = CASE
            WHEN json_valid(capture_metadata_json)
            THEN json_remove(capture_metadata_json, '${metadataPath}')
            ELSE capture_metadata_json
          END,
          updated_at = ?
      WHERE id = ? AND ${column} = ?
        AND EXISTS (
          SELECT 1 FROM proof_target
          INNER JOIN watchlist ON watchlist.id = proof_target.watchlist_id
          WHERE proof_target.id = proof_capture.proof_target_id
            AND watchlist.user_id = ?
        )
    `,
    new Date().toISOString(),
    proofCaptureId,
    parsed.key,
    ownerId,
  );
  return Number(result.meta?.changes ?? 0);
}

export const MAX_PROOF_ARTIFACT_DELETE_KEYS = MAX_DELETE_KEYS;

export async function compensateUncommittedProofArtifacts(
  env: AppEnv,
  snapshot: LandingPageSnapshotData,
) {
  const values = [
    snapshot.artifactKey,
    snapshot.metadata?.htmlArtifactKey,
    snapshot.metadata?.screenshotArtifactKey,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  const keys = new Set<string>();
  for (const value of values) {
    const parsed = parseProofArtifactKey(value);
    if (!parsed) return { ok: false, deleted: 0, failed: 1 };
    keys.add(parsed.key);
  }
  if (keys.size === 0) return { ok: true, deleted: 0, failed: 0 };
  if (!env.LANDING_PAGE_ARTIFACTS) return { ok: false, deleted: 0, failed: keys.size };

  let deleted = 0;
  let failed = 0;
  for (const key of keys) {
    try {
      await env.LANDING_PAGE_ARTIFACTS.delete(key);
      deleted += 1;
    } catch {
      failed += 1;
    }
  }
  return { ok: failed === 0, deleted, failed };
}
