import {
  EDGE_STALE_WINDOW_SECONDS,
  cacheKeyUrl,
  type EdgeCacheRuntime,
} from "../../workers/edge-cache";

export const EDGE_PROOF_HEADER = "x-0509-edge-cache";

/** Independent SHA-256 → CSP hash source, NOT via the module under test. */
export async function sha256Source(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  let binary = "";
  for (const byte of new Uint8Array(digest)) {
    binary += String.fromCharCode(byte);
  }
  return `'sha256-${btoa(binary)}'`;
}

/** In-memory EdgeCacheRuntime double keyed by URL, like the Workers Cache. */
export function memoryCache(): EdgeCacheRuntime & { keys: () => string[] } {
  const store = new Map<
    string,
    { body: ArrayBuffer; init: { status: number; statusText: string; headers: Headers } }
  >();
  return {
    keys: () => [...store.keys()],
    async match(key: Request | string) {
      const entry = store.get(new Request(key instanceof Request ? key.url : key).url);
      if (!entry) return undefined;
      return new Response(entry.body, {
        status: entry.init.status,
        statusText: entry.init.statusText,
        headers: new Headers(entry.init.headers),
      });
    },
    async put(key: Request, response: Response) {
      store.set(new URL(key.url).toString(), {
        body: (await response.clone().arrayBuffer()) as ArrayBuffer,
        init: {
          status: response.status,
          statusText: response.statusText,
          headers: new Headers(response.headers),
        },
      });
    },
  };
}

export function anonymousGet(url = "https://0509.io/", headers: Record<string, string> = {}) {
  return new Request(url, { method: "GET", headers });
}

/** Rewrite the stored copy's stored-at stamp to look `ageSeconds` old and its
 * body to `body` — used to age a copy in place without the test waiting. The
 * headers mirror what storeEdgeCache actually writes: a cache-control
 * stretched to ttl + the serve-stale window (the matchable lifetime) plus the
 * fresh-ttl stamp the served reply is rewritten from. */
export async function overwriteStoredCopy(
  cache: EdgeCacheRuntime,
  request: Request,
  country: string,
  versionId: string,
  ageSeconds: number,
  body: string,
  ttlSeconds = 300,
) {
  await cache.put(
    new Request(cacheKeyUrl(new URL(request.url), country, versionId)),
    new Response(body, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": `public, max-age=${ttlSeconds + EDGE_STALE_WINDOW_SECONDS}`,
        "x-0509-edge-ttl": String(ttlSeconds),
        "x-0509-edge-stored-at": String(Math.floor(Date.now() / 1000) - ageSeconds),
      },
    }),
  );
}
