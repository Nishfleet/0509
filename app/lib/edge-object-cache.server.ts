/**
 * Issue #3782: shared Cache API object cache for values that used to live in
 * per-isolate `Map`s. An in-isolate Map dies with its isolate, so every cold
 * start re-paid the fetch/compute it had just cached; the Cache API persists
 * across isolate restarts within a colo and needs no binding or provisioning.
 *
 * Contract:
 * - entries are stored in a caller-named cache under synthetic
 *   `https://*.0509.internal/...` keys (the same scheme
 *   creative-edge-cache.server.ts uses);
 * - JSON expiry is carried INSIDE the envelope (`exp`) and checked on read —
 *   the stored `cache-control` is a runtime hint, this check is authoritative;
 * - `caches` absent (node tests, non-Worker callers) means "no cache": reads
 *   miss, writes no-op, and callers must stay correct either way;
 * - every failure degrades to a miss — a broken cache must never fail the
 *   request that only wanted to avoid a refetch.
 */

async function openEdgeObjectCache(name: string): Promise<Cache | null> {
  if (typeof caches === "undefined") {
    return null;
  }
  try {
    return await caches.open(name);
  } catch {
    return null;
  }
}

type EdgeCacheEnvelope<T> = {
  /** The stored value. `null` is a real cached answer, not a miss. */
  v: T;
  /** Epoch-ms expiry, or null for "until the cache evicts it". */
  exp: number | null;
};

/**
 * Read a JSON entry. Returns `undefined` on miss/expired/unavailable; a stored
 * `null` round-trips as `null`, so callers can cache negative answers.
 */
export async function readCachedJson<T>(
  cacheName: string,
  key: string,
): Promise<T | undefined> {
  const cache = await openEdgeObjectCache(cacheName);
  if (!cache) {
    return undefined;
  }
  try {
    const hit = await cache.match(key);
    if (!hit) {
      return undefined;
    }
    const entry = (await hit.json()) as EdgeCacheEnvelope<T>;
    if (entry.exp != null && entry.exp <= Date.now()) {
      void cache.delete(key).catch(() => undefined);
      return undefined;
    }
    return entry.v;
  } catch {
    return undefined;
  }
}

/** Write a JSON entry; `ttlMs` null caches until the runtime evicts it. */
export async function writeCachedJson<T>(
  cacheName: string,
  key: string,
  value: T,
  ttlMs: number | null,
): Promise<void> {
  const cache = await openEdgeObjectCache(cacheName);
  if (!cache) {
    return;
  }
  const envelope: EdgeCacheEnvelope<T> = {
    v: value,
    exp: ttlMs == null ? null : Date.now() + ttlMs,
  };
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (ttlMs != null) {
    headers["cache-control"] = `public, max-age=${Math.ceil(ttlMs / 1000)}`;
  }
  try {
    await cache.put(
      key,
      new Response(JSON.stringify(envelope), { headers }),
    );
  } catch {
    // A failed write only means the next read refetches.
  }
}

/** Read raw bytes (e.g. a rasterized PNG). Miss/unavailable → null. */
export async function readCachedBytes(
  cacheName: string,
  key: string,
): Promise<Uint8Array | null> {
  const cache = await openEdgeObjectCache(cacheName);
  if (!cache) {
    return null;
  }
  try {
    const hit = await cache.match(key);
    if (!hit) {
      return null;
    }
    return new Uint8Array(await hit.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Write raw bytes with a `cache-control` max-age. `Uint8Array` is not itself a
 * `BodyInit` under the Worker lib types, so the bytes are copied into a plain
 * `ArrayBuffer` view first (same workaround as creative-edge-cache).
 */
export async function writeCachedBytes(
  cacheName: string,
  key: string,
  bytes: Uint8Array,
  contentType: string,
  maxAgeSeconds: number,
): Promise<void> {
  const cache = await openEdgeObjectCache(cacheName);
  if (!cache) {
    return;
  }
  try {
    const body = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    await cache.put(
      key,
      new Response(body, {
        headers: {
          "content-type": contentType,
          "cache-control": `public, max-age=${maxAgeSeconds}`,
        },
      }),
    );
  } catch {
    // A failed write only means the next read recomputes.
  }
}

/** Drop a whole named cache. Used by test reset helpers; no-op off-Worker. */
export async function dropEdgeObjectCacheForTests(cacheName: string): Promise<void> {
  if (typeof caches === "undefined") {
    return;
  }
  await caches.delete(cacheName).catch(() => undefined);
}
