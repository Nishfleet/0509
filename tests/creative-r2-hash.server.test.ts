import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppEnv } from "~/lib/env.server";

/**
 * Issue #2981 — content-hash R2 persistence for captured creatives.
 *
 * Covers what the ticket is judged on:
 *  1. the hash key is a validated SHA-256 hex digest under `creatives/hash/`;
 *  2. an upload is idempotent and deduplicating by content hash;
 *  3. `/creative/:id` serves the R2 copy FIRST and never touches fbcdn;
 *  4. a live fetch back-fills R2 by hash and persists the hash on the ad row.
 */

const FB_URL =
  "https://scontent-bos5-1.xx.fbcdn.net/v/t39/creative.jpg?oh=abc&oe=6AA7C003";
const HASH = "a".repeat(64);

/** Minimal R2Bucket stand-in backed by a Map. */
function fakeR2() {
  type Obj = { bytes: Uint8Array; contentType: string };
  const objects = new Map<string, Obj>();
  const raw = {
    head: vi.fn(async (key: string) =>
      objects.has(key) ? ({ key } as never) : null,
    ),
    get: vi.fn(async (key: string) => {
      const object = objects.get(key);
      if (!object) {
        return null;
      }
      return {
        httpMetadata: { contentType: object.contentType },
        etag: "etag-1",
        arrayBuffer: async () => new Uint8Array(object.bytes).buffer,
      } as never;
    }),
    put: vi.fn(async (key: string, value: Uint8Array) => {
      objects.set(key, { bytes: new Uint8Array(value), contentType: "image/jpeg" });
      return {} as never;
    }),
  };
  return { bucket: raw as unknown as R2Bucket, objects, raw };
}

type EnvOpts = {
  url?: string | null;
  hash?: string | null;
  r2?: ReturnType<typeof fakeR2>;
};

function makeStatement(urls: { url: string | null; hash: string | null }) {
  const statement = {
    bind: vi.fn(() => statement),
    first: vi.fn(async () => {
      const row: Record<string, string | null> = {};
      if (urls.url !== null) {
        row.creative_image_url = urls.url;
      }
      if (urls.hash !== null) {
        row.creative_hash = urls.hash;
      }
      return Object.keys(row).length ? row : null;
    }),
    run: vi.fn(async () => ({})),
    all: vi.fn(async () => ({ results: [] })),
    raw: vi.fn(),
  };
  return statement;
}

function makeEnv(opts: EnvOpts = {}) {
  const statement = makeStatement({ url: opts.url ?? null, hash: opts.hash ?? null });
  const env = {
    DB: { prepare: vi.fn(() => statement) },
    LANDING_PAGE_ARTIFACTS: opts.r2?.bucket,
  } as unknown as AppEnv;
  return { env, statement };
}

function installCaches() {
  const store = new Map<string, Response>();
  const cache = {
    match: vi.fn(async (key: string) => store.get(key)?.clone()),
    put: vi.fn(async (key: string, response: Response) => {
      store.set(key, response.clone());
    }),
  };
  (globalThis as unknown as { caches: unknown }).caches = {
    open: vi.fn(async () => cache),
  };
  return { store, cache };
}

function installFetch() {
  return vi.doMock("~/lib/fetch-timeout.server", () => ({
    fetchWithTimeout: vi.fn(async () =>
      new Response(new Uint8Array([7, 8, 9]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    ),
    releaseFetchTimeout: vi.fn(),
  }));
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("~/lib/fetch-timeout.server");
  delete (globalThis as unknown as { caches?: unknown }).caches;
});

describe("creative-r2-hash", () => {
  it("keys are validated SHA-256 hex under creatives/hash/", async () => {
    const { creativeHashObjectKey, isSha256Hex } = await import(
      "~/lib/creative-r2-hash.server"
    );

    expect(creativeHashObjectKey(HASH)).toBe(`creatives/hash/${HASH}`);
    expect(creativeHashObjectKey("short")).toBeNull();
    expect(creativeHashObjectKey("z".repeat(64))).toBeNull();
    expect(creativeHashObjectKey(null)).toBeNull();
    expect(creativeHashObjectKey(undefined)).toBeNull();
    expect(creativeHashObjectKey({} as unknown as string)).toBeNull();
    expect(isSha256Hex(`${HASH}x`)).toBe(false);
    expect(isSha256Hex({} as unknown as string)).toBe(false);
  });

  it("sha256Hex matches the SHA-256 test vectors", async () => {
    const { sha256Hex } = await import("~/lib/creative-r2-hash.server");

    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(await sha256Hex(new Uint8Array(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("stores by content hash and deduplicates a second upload", async () => {
    const { storeCreativeImageByHash } = await import("~/lib/creative-r2-hash.server");
    const r2 = fakeR2();
    const { env } = makeEnv({ r2 });

    const first = await storeCreativeImageByHash(
      env,
      new Uint8Array([1, 2, 3]),
      "image/jpeg",
    );
    expect(first).not.toBeNull();
    expect(first!.key).toBe(`creatives/hash/${first!.hash}`);
    expect(/^[a-f0-9]{64}$/.test(first!.hash)).toBe(true);
    expect(r2.raw.put).toHaveBeenCalledTimes(1);

    const second = await storeCreativeImageByHash(
      env,
      new Uint8Array([1, 2, 3]),
      "image/jpeg",
    );
    expect(second!.hash).toBe(first!.hash);
    // head short-circuits the second upload: bytes, not identity, decide.
    expect(r2.raw.put).toHaveBeenCalledTimes(1);
  });

  it("returns null when the bucket binding is missing", async () => {
    const { storeCreativeImageByHash } = await import("~/lib/creative-r2-hash.server");
    const { env } = makeEnv({});
    expect(
      await storeCreativeImageByHash(env, new Uint8Array([1]), "image/jpeg"),
    ).toBeNull();
  });

  it("/creative/:id serves the R2 hash copy first without touching fbcdn", async () => {
    installFetch();
    const { serveCreativeResource } = await import("~/lib/creative-edge-cache.server");
    const { fetchWithTimeout } = await import("~/lib/fetch-timeout.server");
    const r2 = fakeR2();
    await r2.raw.put(`creatives/hash/${HASH}`, new Uint8Array([5, 6, 7]));
    (r2.raw.put as unknown as ReturnType<typeof vi.fn>).mockClear();
    const { cache } = installCaches();
    const { env } = makeEnv({ url: FB_URL, hash: HASH, r2 });

    const response = await serveCreativeResource(
      env,
      new Request("https://0509.io/creative/ad_1"),
      "ad_1",
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe("image/jpeg");
    // Issue #2981 core guarantee: no request to the signed fbcdn URL.
    const fetchMock = fetchWithTimeout as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls).toHaveLength(0);
    // The Cache API still gets filled for later request-speed hits.
    expect(cache.put).toHaveBeenCalledTimes(1);
    // Nothing was re-uploaded on a pure serve path.
    expect(r2.raw.put).not.toHaveBeenCalled();
  });

  it("/creative/:id prefers the R2 hash copy over a WARM Cache-API entry", async () => {
    // The Cache API entry carries a 30-day immutable TTL. If the R2 read sat
    // behind cache.match, a warm entry fetched from a rotting fbcdn URL would
    // mask the hash-keyed bytes — the exact failure #2981 exists to remove.
    const { serveCreativeResource } = await import("~/lib/creative-edge-cache.server");
    const r2 = fakeR2();
    await r2.raw.put(`creatives/hash/${HASH}`, new Uint8Array([5, 6, 7]));
    const { store } = installCaches();
    // Seed a stale cache entry, as a capture-time prime would have left behind.
    store.set(
      "https://creative.0509.internal/ad_1",
      new Response(new Uint8Array([9, 9, 9]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    );
    const { env } = makeEnv({ url: FB_URL, hash: HASH, r2 });

    const response = await serveCreativeResource(
      env,
      new Request("https://0509.io/creative/ad_1"),
      "ad_1",
    );

    expect(response?.status).toBe(200);
    // R2 bytes, not the stale cached body.
    const body = new Uint8Array(await response!.arrayBuffer());
    expect(Array.from(body)).toEqual([5, 6, 7]);
  });

  it("still serves the page when the R2 read throws", async () => {
    installFetch();
    const { serveCreativeResource } = await import("~/lib/creative-edge-cache.server");
    const r2 = fakeR2();
    (r2.raw.head as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("r2 unavailable"),
    );
    (r2.raw.get as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("r2 unavailable"),
    );
    installCaches();
    const { env } = makeEnv({ url: FB_URL, hash: HASH, r2 });

    const response = await serveCreativeResource(
      env,
      new Request("https://0509.io/creative/ad_1"),
      "ad_1",
    );

    // A broken R2 must degrade to the fetch path, never a 500.
    expect(response?.status).toBe(200);
  });

  it("still serves the image when persisting the hash fails", async () => {
    installFetch();
    const { serveCreativeResource } = await import("~/lib/creative-edge-cache.server");
    const r2 = fakeR2();
    installCaches();
    const { env, statement } = makeEnv({ url: FB_URL, hash: null, r2 });
    (statement.run as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("d1 write failed"),
    );

    const response = await serveCreativeResource(
      env,
      new Request("https://0509.io/creative/ad_1"),
      "ad_1",
    );

    // The R2 mirror still landed; only the hash write failed.
    expect(r2.raw.put).toHaveBeenCalledTimes(1);
    expect(response?.status).toBe(200);
  });

  it("/creative/:id back-fills R2 by hash and persists the hash on a live URL", async () => {
    installFetch();
    const { serveCreativeResource } = await import("~/lib/creative-edge-cache.server");
    const r2 = fakeR2();
    installCaches();
    const { env, statement } = makeEnv({ url: FB_URL, hash: null, r2 });

    const response = await serveCreativeResource(
      env,
      new Request("https://0509.io/creative/ad_1"),
      "ad_1",
    );

    expect(response?.status).toBe(200);
    // The R2 mirror exists — the same creative is now served past fbcdn expiry.
    expect(r2.raw.put).toHaveBeenCalledTimes(1);
    const uploadedKey = (r2.raw.put as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][0] as string;
    expect(uploadedKey).toMatch(/^creatives\/hash\/[a-f0-9]{64}$/);
    // ...and the hash was written back onto the ad row via json_set.
    const preparedQueries = (env.DB as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare.mock
      .calls as unknown as string[][];
    const hashUpdate = preparedQueries.map((call) => call[0] as string).find((q) =>
      q.includes("json_set"),
    );
    expect(hashUpdate).toContain("$.creativeHash");
    expect(hashUpdate).toContain("$.creativeHashContentType");
    expect(statement.run).toHaveBeenCalled();
    // The bound VALUES matter, not the SQL text: swapping two parameters would
    // still contain both key names and pass a text-only assertion.
    const bound = JSON.stringify(statement.bind.mock.calls.at(-1));
    expect(bound).toContain(uploadedKey.replace("creatives/hash/", ""));
    expect(bound).toContain("image/jpeg");
  });
});
