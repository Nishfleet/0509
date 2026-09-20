import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Issue #3782 — shared Cache API object cache. `caches` is not a node global,
 * so the suite installs the same minimal stand-in creative-edge-cache uses.
 */

function installCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const makeCache = (store: Map<string, Response>) => ({
    match: vi.fn(async (key: string) => store.get(key)?.clone()),
    put: vi.fn(async (key: string, response: Response) => {
      store.set(key, response.clone());
    }),
    delete: vi.fn(async (key: string) => store.delete(key)),
  });
  const cachesMock = {
    open: vi.fn(async (name: string) => {
      let store = stores.get(name);
      if (!store) {
        store = new Map();
        stores.set(name, store);
      }
      return makeCache(store);
    }),
    delete: vi.fn(async (name: string) => stores.delete(name)),
  };
  (globalThis as unknown as { caches: unknown }).caches = cachesMock;
  return { stores, cachesMock };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as unknown as { caches?: unknown }).caches;
});

describe("edge object cache", () => {
  it("round-trips a JSON value through a named cache until the TTL expires", async () => {
    const { stores } = installCaches();
    const { readCachedJson, writeCachedJson } = await import(
      "~/lib/edge-object-cache.server"
    );
    const key = "https://x.0509.internal/k";
    await writeCachedJson("n1", key, { ok: true }, 60_000);
    expect(await readCachedJson("n1", key)).toEqual({ ok: true });
    // Named caches are isolated — a miss is a miss, not a cross-read.
    expect(await readCachedJson("n2", key)).toBeUndefined();
    expect(stores.get("n1")!.has(key)).toBe(true);
  });

  it("distinguishes a cached null from a miss", async () => {
    installCaches();
    const { readCachedJson, writeCachedJson } = await import(
      "~/lib/edge-object-cache.server"
    );
    const key = "https://x.0509.internal/neg";
    await writeCachedJson("n1", key, null, 60_000);
    // undefined = miss; null = a real cached negative answer.
    expect(await readCachedJson("n1", key)).toBeNull();
    expect(await readCachedJson("n1", "https://x.0509.internal/absent")).toBeUndefined();
  });

  it("treats an expired envelope as a miss and drops the entry", async () => {
    installCaches();
    const { readCachedJson, writeCachedJson } = await import(
      "~/lib/edge-object-cache.server"
    );
    const key = "https://x.0509.internal/exp";
    await writeCachedJson("n1", key, "v", -1); // already expired
    expect(await readCachedJson("n1", key)).toBeUndefined();
  });

  it("round-trips bytes with a content type", async () => {
    installCaches();
    const { readCachedBytes, writeCachedBytes } = await import(
      "~/lib/edge-object-cache.server"
    );
    const key = "https://x.0509.internal/img";
    const bytes = new Uint8Array([137, 80, 78, 71]);
    await writeCachedBytes("n1", key, bytes, "image/png", 300);
    expect(await readCachedBytes("n1", key)).toEqual(bytes);
  });

  it("degrades to no-cache when the caches global is absent", async () => {
    const { readCachedJson, writeCachedJson, readCachedBytes } = await import(
      "~/lib/edge-object-cache.server"
    );
    await writeCachedJson("n1", "https://x.0509.internal/k", 1, 60_000);
    expect(await readCachedJson("n1", "https://x.0509.internal/k")).toBeUndefined();
    expect(await readCachedBytes("n1", "https://x.0509.internal/k")).toBeNull();
  });

  it("drops a whole named cache for test reset helpers", async () => {
    const { cachesMock } = installCaches();
    const { writeCachedJson, readCachedJson, dropEdgeObjectCacheForTests } =
      await import("~/lib/edge-object-cache.server");
    await writeCachedJson("n1", "https://x.0509.internal/k", 1, 60_000);
    await dropEdgeObjectCacheForTests("n1");
    expect(cachesMock.delete).toHaveBeenCalledWith("n1");
    expect(await readCachedJson("n1", "https://x.0509.internal/k")).toBeUndefined();
  });
});
