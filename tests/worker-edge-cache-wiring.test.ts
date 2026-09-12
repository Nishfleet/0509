import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Issue #2950 — the anonymous public-HTML edge cache, WIRING layer.
 *
 * The REAL worker fetch handler, exactly like tests/worker-csp-nonce.test.ts
 * but with `caches` stubbed: the second identical anonymous GET comes from
 * the cache — the router is never called again, the MISS→HIT stamps tell the
 * truth, the HIT document's CSP carries NO nonce and authorises every inline
 * script in its own body by hash, a cookie-carrying (logged-in) request
 * always renders fresh WITH its nonce, and a new `CF_VERSION_METADATA.id` —
 * what every deploy produces — misses, re-renders, and re-arms. That last one
 * IS the safe deploy invalidation path, exercised end to end.
 *
 * Also proven: a HEAD after a warm GET gets the stored copy's headers with no
 * body (the `curl -sI` proof surface), /pricing — not just the homepage —
 * participates, and a stale-inside-the-window serve stays instant AND queues
 * one background re-render via ctx.waitUntil (#3247 serve-stale), so
 * probe-only traffic keeps the edge warm.
 *
 * Split from tests/worker-edge-cache.test.ts under the file-size ratchet
 * (issue #2376); the unit and nonce-free-variant layers stayed behind.
 * Shared doubles live in tests/helpers/edge-cache-kit.ts.
 */
import { EDGE_HTML_CACHE_NAME } from "../workers/edge-cache";
import {
  EDGE_PROOF_HEADER,
  anonymousGet,
  memoryCache,
  overwriteStoredCopy,
  sha256Source,
} from "./helpers/edge-cache-kit";

const SYMBOL_FOR_TEST = Symbol("cloudflareRuntimeContext");

const WIRING_BOOT_SCRIPT = `(function(){try{var s=1}catch(e){}})();`;
const WIRING_MODULE_SCRIPT = `window.__wired = true;`;

async function loadWorker() {
  let capturedNonce: string | undefined;
  const htmlDocument = () =>
    new Response(
      [
        "<!doctype html><html><head>",
        `<script src="/assets/root-abc.js" type="module"></script>`,
        `<script type="application/ld+json">{"@type":"Organization"}</script>`,
        `<script nonce="${capturedNonce ?? ""}">${WIRING_BOOT_SCRIPT}</script>`,
        `<script type="module" async="" nonce="${capturedNonce ?? ""}">${WIRING_MODULE_SCRIPT}</script>`,
        "</head><body>0509</body></html>",
      ].join(""),
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );

  vi.doMock("react-router", () => ({
    createRequestHandler:
      () => async (_request: Request, context: { get: (k: unknown) => unknown }) => {
        const value = context.get(SYMBOL_FOR_TEST) as { cspNonce?: string } | undefined;
        capturedNonce = value?.cspNonce;
        return htmlDocument();
      },
    RouterContextProvider: class RouterContextProvider {
      private readonly store = new Map<unknown, unknown>();
      set(key: unknown, value: unknown) {
        this.store.set(key, value);
      }
      get(key: unknown) {
        return this.store.get(key);
      }
    },
  }));
  vi.doMock("../app/lib/cloudflare-context", () => ({
    cloudflareRuntimeContext: SYMBOL_FOR_TEST,
  }));
  vi.doMock("../app/lib/locale-markets", () => ({ isBuyerSurfaceLocaleId: () => false }));
  vi.doMock("../workers/primary-domain", () => ({ primaryDomainRedirect: () => null }));
  vi.doMock("../app/lib/seo", () => ({ publicSeoFileForPathname: () => null }));
  vi.doMock("../app/lib/public-markdown", () => ({
    PUBLIC_MARKDOWN: "# markdown",
    buildLlmsText: () => "# llms",
    isPublicMarkdownPage: () => false,
    wantsPublicMarkdown: () => false,
  }));
  vi.doMock("../app/lib/sitemap.server", () => ({ publicSitemapForPathname: () => null }));
  vi.doMock("../app/lib/social-cards.server", () => ({ publicSocialCardForRequest: () => null }));
  vi.doMock("../app/lib/creative-thumbnail.server", () => ({
    parseCreativeArtifactPathname: () => null,
    serveCreativeArtifact: async () => null,
  }));
  vi.doMock("../app/lib/proof-screenshot", () => ({ parseProofScreenshotPathname: () => null }));
  vi.doMock("../app/lib/proof-screenshot.server", () => ({ serveProofScreenshot: async () => null }));
  vi.doMock("../app/lib/proof-page-text", () => ({ parseProofPageTextPathname: () => null }));
  vi.doMock("../app/lib/proof-page-text.server", () => ({ serveProofPageText: async () => null }));
  vi.doMock("../app/lib/marketing-page-html.server", () => ({
    marketingPageHtmlForPathname: () => null,
  }));
  vi.doMock("../workers/monitoring-workflow", () => ({ MonitoringWorkflow: class {} }));
  vi.doMock("../workers/delivery-recovery", () => ({
    scheduleBillingLifecycleEmailRecovery: vi.fn(),
  }));
  vi.doMock("../workers/digest-schedule-recovery", () => ({
    scheduleDigestScheduleExhaustionRecovery: vi.fn(),
  }));

  const workerModule = await import("../workers/app");
  return { worker: workerModule.default, capturedNonce: () => capturedNonce };
}

interface FetchOptions {
  path?: string;
  env?: Record<string, unknown>;
  headers?: Record<string, string>;
  method?: string;
  tasks?: Promise<unknown>[];
}

async function fetchDocument(
  worker: { fetch: unknown },
  { path = "/", env = {}, headers = {}, method = "GET", tasks }: FetchOptions = {},
) {
  return (
    worker.fetch as (request: Request, e: unknown, c: unknown) => Promise<Response>
  )(
    new Request(`https://0509.io${path}`, {
      method,
      headers: { accept: "text/html", ...headers },
    }),
    env,
    {
      waitUntil(promise: Promise<unknown>) {
        tasks?.push(promise);
      },
      passThroughOnException() {},
    },
  );
}

function scriptSrcOf(response: Response): string | undefined {
  return (response.headers.get("content-security-policy") ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("script-src "));
}

function cspNonceOf(response: Response): string | undefined {
  return /'nonce-([^']+)'/.exec(scriptSrcOf(response) ?? "")?.[1];
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("edge cache through the real worker fetch handler (issue #2950)", () => {
  it("serves the second identical anonymous GET from the cache; the router never runs again", async () => {
    const stub = memoryCache();
    vi.stubGlobal("caches", {
      open: async (name: string) => {
        expect(name).toBe(EDGE_HTML_CACHE_NAME);
        return stub;
      },
    });
    const { worker, capturedNonce: nonceSeen } = await loadWorker();

    const first = await fetchDocument(worker);
    expect(first.headers.get(EDGE_PROOF_HEADER)).toBe("MISS");
    const firstBody = await first.text();
    const firstNonceSeen = nonceSeen();
    expect(firstNonceSeen).toBeTruthy(); // the router DID render once
    // The rendered nonce is gone from the anonymous variant: the document the
    // first visitor receives is already the stored nonce-free copy.
    expect(cspNonceOf(first)).toBeUndefined();

    const second = await fetchDocument(worker);
    expect(second.headers.get(EDGE_PROOF_HEADER)).toBe("HIT");
    const secondBody = await second.text();
    expect(secondBody).toBe(firstBody);
    // The HIT skipped the render: the nonce the worker handed the router is
    // still the FIRST request's.
    expect(nonceSeen()).toBe(firstNonceSeen);

    // The #2716 condition, end to end: the HIT's script-src carries NO nonce,
    // and EVERY inline executable script in its own body is authorised by a
    // content hash (computed here independently of the module under test).
    const hitScriptSrc = scriptSrcOf(second);
    expect(hitScriptSrc).not.toContain("'nonce-");
    expect(secondBody).toContain("<script"); // sanity: the fixture really carries inline scripts
    const inlineBodies = [
      WIRING_BOOT_SCRIPT,
      WIRING_MODULE_SCRIPT,
    ];
    for (const body of inlineBodies) {
      expect(hitScriptSrc).toContain(await sha256Source(body));
    }
    // The ld+json data block and the external asset script are NOT hashed
    // (covered by the directive's other rules) — exactly two hash sources.
    expect(hitScriptSrc?.match(/'sha256-/g)).toHaveLength(2);
  });

  it("keeps logged-in (cookie) requests fresh: never stored, never replayed, nonce intact", async () => {
    const stub = memoryCache();
    vi.stubGlobal("caches", { open: async () => stub });
    const { worker, capturedNonce: nonceSeen } = await loadWorker();

    const anonymousFirst = await fetchDocument(worker);
    const anonymousBody = await anonymousFirst.clone().text();
    expect(anonymousFirst.headers.get(EDGE_PROOF_HEADER)).toBe("MISS");

    const authed = await fetchDocument(worker, {
      headers: { cookie: "better-auth.session_token=abc" },
    });
    // Not stamped: it never touched the cache. And it is a FRESH render, not
    // the anonymous one (the root loader embeds the session in the document),
    // still carrying its own per-request nonce.
    expect(authed.headers.has(EDGE_PROOF_HEADER)).toBe(false);
    expect(cspNonceOf(authed)).toBeTruthy();
    expect(nonceSeen()).toBe(cspNonceOf(authed));

    // And the anonymous variant is still the one being served afterwards.
    const anonymousSecond = await fetchDocument(worker);
    expect(anonymousSecond.headers.get(EDGE_PROOF_HEADER)).toBe("HIT");
    expect(await anonymousSecond.text()).toBe(anonymousBody);
  });

  it("re-renders after a deploy: a new CF_VERSION_METADATA.id misses, re-renders, re-arms", async () => {
    const stub = memoryCache();
    vi.stubGlobal("caches", { open: async () => stub });
    const { worker, capturedNonce: nonceSeen } = await loadWorker();
    const envFor = (id: string) => ({ CF_VERSION_METADATA: { id } });

    expect(
      (await fetchDocument(worker, { env: envFor("v1") })).headers.get(EDGE_PROOF_HEADER),
    ).toBe("MISS");
    const deployOneNonce = nonceSeen();
    expect(deployOneNonce).toBeTruthy();
    expect((await fetchDocument(worker, { env: envFor("v1") })).headers.get(EDGE_PROOF_HEADER)).toBe(
      "HIT",
    );

    // The deploy: fresh version id -> fresh key -> a real render again (the
    // router ran once more, so a NEW nonce was minted even though the served
    // document never carries one).
    const afterDeploy = await fetchDocument(worker, { env: envFor("v2") });
    expect(afterDeploy.headers.get(EDGE_PROOF_HEADER)).toBe("MISS");
    expect(nonceSeen()).not.toBe(deployOneNonce);
    expect(cspNonceOf(afterDeploy)).toBeUndefined();
    expect((await fetchDocument(worker, { env: envFor("v2") })).headers.get(EDGE_PROOF_HEADER)).toBe(
      "HIT",
    );
  });

  it("re-renders in the background when a stale copy serves, so the next hit is fresh (#3247)", async () => {
    const stub = memoryCache();
    vi.stubGlobal("caches", { open: async () => stub });
    const { worker, capturedNonce: nonceSeen } = await loadWorker();
    const tasks: Promise<unknown>[] = [];

    const first = await fetchDocument(worker, { tasks });
    expect(first.headers.get(EDGE_PROOF_HEADER)).toBe("MISS");
    const firstNonce = nonceSeen();
    expect(firstNonce).toBeTruthy();
    expect(tasks).toHaveLength(0);

    // Age the stored copy past its fresh bound, still inside the stale
    // window (the anonymous wiring request has no cf-ipcountry → country
    // "xx", and no CF_VERSION_METADATA env → version "local").
    await overwriteStoredCopy(stub, anonymousGet(), "xx", "local", 720, "<html>stale-copy</html>");

    // The stale copy serves instantly as a HIT, and exactly one background
    // re-render is queued through ctx.waitUntil.
    const stale = await fetchDocument(worker, { tasks });
    expect(stale.headers.get(EDGE_PROOF_HEADER)).toBe("HIT");
    expect(await stale.text()).toContain("stale-copy");
    expect(tasks).toHaveLength(1);

    // Running the queued refresh re-renders (a NEW nonce was minted — the
    // router ran again) and re-stores, so the next hit serves the fresh copy.
    await Promise.all(tasks);
    expect(nonceSeen()).not.toBe(firstNonce);
    const refreshed = await fetchDocument(worker, { tasks });
    expect(refreshed.headers.get(EDGE_PROOF_HEADER)).toBe("HIT");
    expect(await refreshed.text()).toContain("0509");
    // A FRESH hit queues no refresh — the background render only fires stale.
    expect(tasks).toHaveLength(1);
  });

  it("answers a HEAD after a warm GET with the stored copy's headers and no body (the curl -sI proof)", async () => {
    const stub = memoryCache();
    vi.stubGlobal("caches", { open: async () => stub });
    const { worker } = await loadWorker();

    await fetchDocument(worker);
    const headHit = await fetchDocument(worker, { method: "HEAD" });
    expect(headHit.headers.get(EDGE_PROOF_HEADER)).toBe("HIT");
    expect(headHit.status).toBe(200);
    expect(headHit.headers.get("content-type")).toContain("text/html");
    expect(headHit.headers.get("cache-control")).toBe("public, max-age=300");
    expect(scriptSrcOf(headHit)).not.toContain("'nonce-");
    expect(await headHit.text()).toBe("");

    // The stored GET survived the headOf reply untouched.
    const warmed = await fetchDocument(worker);
    expect(warmed.headers.get(EDGE_PROOF_HEADER)).toBe("HIT");
    expect(await warmed.text()).toContain("0509");
  });

  it("covers the other marketing pages, and leaves ineligible renders unstamped", async () => {
    const stub = memoryCache();
    vi.stubGlobal("caches", { open: async () => stub });
    const { worker } = await loadWorker();

    const pricingMiss = await fetchDocument(worker, { path: "/pricing" });
    expect(pricingMiss.headers.get(EDGE_PROOF_HEADER)).toBe("MISS");
    expect((await fetchDocument(worker, { path: "/pricing" })).headers.get(EDGE_PROOF_HEADER)).toBe(
      "HIT",
    );

    // Not in PUBLIC_CACHEABLE_HTML_PATHS: no stamp, no key.
    const outsider = await fetchDocument(worker, { path: "/compare/unknown-page" });
    expect(outsider.headers.has(EDGE_PROOF_HEADER)).toBe(false);
    expect(cspNonceOf(outsider)).toBeTruthy(); // untouched path keeps its nonce
    expect(stub.keys()).toHaveLength(1);
  });
});
