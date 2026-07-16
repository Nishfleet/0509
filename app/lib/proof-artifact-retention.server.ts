import { queryAll } from "~/lib/data/d1.server";
import type { AppEnv } from "~/lib/env.server";

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
    | "unreferenced"
    | "invalid_key"
    | "r2_failed";
  r2: "deleted" | "missing" | "not_attempted" | "failed";
  d1: "not_updated";
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
  if (inventory.referenceState === "shared") {
    return { key: parsed.key, ok: false, outcome: "shared_reference", r2: "not_attempted", d1: "not_updated" };
  }
  if (!env.LANDING_PAGE_ARTIFACTS) {
    return { key: parsed.key, ok: false, outcome: "r2_failed", r2: "failed", d1: "not_updated" };
  }

  try {
    const existing = await env.LANDING_PAGE_ARTIFACTS.head(parsed.key);
    if (!existing) {
      return { key: parsed.key, ok: true, outcome: "missing", r2: "missing", d1: "not_updated" };
    }
    await env.LANDING_PAGE_ARTIFACTS.delete(parsed.key);
    return { key: parsed.key, ok: true, outcome: "deleted", r2: "deleted", d1: "not_updated" };
  } catch {
    return { key: parsed.key, ok: false, outcome: "r2_failed", r2: "failed", d1: "not_updated" };
  }
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

export const MAX_PROOF_ARTIFACT_DELETE_KEYS = MAX_DELETE_KEYS;
