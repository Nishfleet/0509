/**
 * Issue #2981 — content-hash R2 persistence for captured ad creatives.
 *
 * The `/creative/:id` edge cache (issue #2393) is Cache-API and fetch-time:
 * after fbcdn's signed URL dies, a first view after day 4 can only serve the
 * 1x1 placeholder, because nothing on our side owns the bytes. The saved-
 * collection path (WP-10) already persists to R2, but keyed by `metaAdId` —
 * the same image captured under two ads is stored twice, and there is no
 * integrity check tying the bytes to the capture.
 *
 * This module stores every captured creative in R2 keyed by its SHA-256
 * content hash, under `creatives/hash/<sha256-hex>` in the existing
 * `LANDING_PAGE_ARTIFACTS` bucket. A content-hash key is idempotent and
 * deduplicating: the same bytes uploaded by N captures cost one object.
 *
 * No D1 schema migration is involved: the hash rides on `ad.raw_json`
 * (`$.creativeHash` / `$.creativeHashType`), the same JSON column the rest of
 * the ad persistence path uses — so previous code versions keep reading their
 * own columns and nothing here can break an auto-revert.
 */

import { bindD1Named } from "~/lib/d1-bind.server";
import type { AppEnv } from "~/lib/env.server";

/** Hash-keyed objects live beside the WP-10 `creatives/<id>` objects. */
export const CREATIVE_HASH_KEY_PREFIX = "creatives/hash/";

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

/** True when `hash` is a lowercase 64-hex SHA-256 digest. */
export function isSha256Hex(hash: string | null | undefined): boolean {
  return typeof hash === "string" && SHA256_HEX_PATTERN.test(hash);
}

/** The R2 key for a validated content hash, or null for an unusable hash. */
export function creativeHashObjectKey(hash: string | null | undefined): string | null {
  if (!isSha256Hex(hash)) {
    return null;
  }
  return `${CREATIVE_HASH_KEY_PREFIX}${hash}`;
}

/**
 * SHA-256 of the image bytes as lowercase hex. Web Crypto is available in the
 * Worker runtime; on a Node test runner it is also global. Never throws —
 * returns null when the digest cannot be computed.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

export type StoredCreativeImage = {
  hash: string;
  key: string;
  contentType: string;
};

/**
 * Store image bytes in R2 under their SHA-256 content hash. Idempotent and
 * deduplicating: an existing object with the same key is left untouched
 * (`head` short-circuits the upload). Returns null when the binding, the
 * digest, or the upload fails — callers treat that as "not persisted" and
 * must still serve the page.
 */
export async function storeCreativeImageByHash(
  env: AppEnv,
  bytes: Uint8Array,
  contentType: string,
): Promise<StoredCreativeImage | null> {
  const bucket = env.LANDING_PAGE_ARTIFACTS;
  if (!bucket) {
    return null;
  }
  const hash = await sha256Hex(bytes);
  const key = creativeHashObjectKey(hash);
  if (!hash || !key) {
    return null;
  }
  try {
    const existing = await bucket.head(key);
    if (existing) {
      return { hash, key, contentType };
    }
    await bucket.put(key, bytes.slice(), {
      httpMetadata: {
        contentType,
        cacheControl: "public, max-age=31536000, immutable",
      },
    });
    return { hash, key, contentType };
  } catch {
    return null;
  }
}

export type CreativeImageObject = {
  bytes: Uint8Array;
  contentType: string;
};

async function objectToImage(bucket: R2Bucket, key: string): Promise<CreativeImageObject | null> {
  const object = await bucket.get(key);
  if (!object) {
    return null;
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.byteLength === 0) {
    return null;
  }
  const contentType = object.httpMetadata?.contentType ?? "application/octet-stream";
  return { bytes, contentType };
}

/**
 * Read a creative image back from R2 by content hash, or null when there is
 * no bucket, the hash is unusable, or the object does not exist. Never throws.
 */
export async function getCreativeImageByHash(
  env: AppEnv,
  hash: string | null | undefined,
): Promise<CreativeImageObject | null> {
  const key = creativeHashObjectKey(hash);
  if (!key) {
    return null;
  }
  try {
    return await objectToImage(env.LANDING_PAGE_ARTIFACTS, key);
  } catch {
    return null;
  }
}

/**
 * The content hash persisted on the ad row, or null. Reads
 * `$.creativeHash` out of `ad.raw_json` — the same column `upsertAd` writes.
 */
export async function lookupStoredCreativeHash(
  env: AppEnv,
  creativeId: string,
): Promise<string | null> {
  if (!env.DB) {
    return null;
  }
  const result = await bindD1Named(
    env.DB.prepare(
      "SELECT json_extract(raw_json, '$.creativeHash') AS creative_hash FROM ad WHERE id = ? LIMIT 1",
    ),
    [["adId", creativeId]],
  ).first<{ creative_hash: string | null }>();
  const value = result?.creative_hash?.trim().toLowerCase() ?? "";
  return isSha256Hex(value) ? value : null;
}

/**
 * Persist the content hash (and its content type) onto the ad row's raw_json
 * using `json_set`, so no other raw_json field is touched and the write is a
 * single atomic statement. Never throws from a caller's control flow.
 */
export async function persistCreativeHash(
  env: AppEnv,
  adId: string,
  stored: StoredCreativeImage,
): Promise<boolean> {
  if (!env.DB) {
    return false;
  }
  try {
    await bindD1Named(
      env.DB.prepare(
        "UPDATE ad SET raw_json = json_set(raw_json, '$.creativeHash', ?2, '$.creativeHashContentType', ?3), updated_at = updated_at WHERE id = ?1",
      ),
      [
        ["adId", adId],
        ["creativeHash", stored.hash],
        ["creativeHashContentType", stored.contentType],
      ],
    ).run();
    return true;
  } catch {
    return false;
  }
}
