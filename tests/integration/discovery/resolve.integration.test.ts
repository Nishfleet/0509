import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  resolveCandidateDomain,
  slugFor,
} from "../../../app/lib/discovery/resolve-domain";

// The cascade is pinned in real workerd because the slug leg is HTMLRewriter —
// the same global the deployed Worker uses. Outbound `fetch` is stubbed per
// case so every branch (Wikidata hit, Wikidata miss, name match, name mismatch,
// unreachable host) is reachable deterministically.

const WIKIDATA_SEARCH_HIT = {
  search: [{ id: "Q56246099", label: "Gymshark" }],
};

const WIKIDATA_P856 = {
  entities: {
    Q56246099: {
      claims: {
        P856: [
          {
            mainsnak: {
              datavalue: { value: "https://www.gymshark.com/" },
            },
          },
        ],
      },
    },
  },
};

const EMPTY_SEARCH = { search: [] };

function htmlPage(siteName: string): string {
  return `<!doctype html><html><head>
<meta property="og:site_name" content="${siteName}">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"${siteName}"}</script>
</head><body><h1>${siteName}</h1></body></html>`;
}

function stubFetch(routes: Record<string, () => { status?: number; body?: unknown }>) {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    for (const [match, respond] of Object.entries(routes)) {
      if (url.includes(match)) {
        const { status = 200, body = {} } = respond();
        const payload = typeof body === "string" ? body : JSON.stringify(body);
        return new Response(payload, {
          status,
          headers: { "content-type": typeof body === "string" ? "text/html" : "application/json" },
        });
      }
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { impl, calls };
}

describe("resolveCandidateDomain", () => {
  it("resolves through Wikidata P856 and checks the homepage is live", async () => {
    const { impl, calls } = stubFetch({
      "wbsearchentities": () => ({ body: WIKIDATA_SEARCH_HIT }),
      "wbgetentities": () => ({ body: WIKIDATA_P856 }),
      "gymshark.com": () => ({ body: htmlPage("Gymshark") }),
    });
    const res = await resolveCandidateDomain("Gymshark", {
      kv: env.RESOLVE_CACHE,
      fetchImpl: impl,
    });
    expect(res).toEqual({ domain: "gymshark.com", via: "wikidata", live: true });
    expect(calls.some((url) => url.includes("wbsearchentities"))).toBe(true);
    expect(calls.some((url) => url.includes("gymshark.com"))).toBe(true);
  });

  it("accepts a slug guess only when the site's own name matches", async () => {
    const { impl } = stubFetch({
      "wikidata.org": () => ({ body: EMPTY_SEARCH }),
      "alphaleteathletics.com": () => ({ body: htmlPage("Alphalete Athletics") }),
    });
    const res = await resolveCandidateDomain("Alphalete Athletics", {
      fetchImpl: impl,
    });
    expect(res).toEqual({ domain: "alphaleteathletics.com", via: "slug", live: true });
  });

  it("refuses a parked domain whose page names somebody else", async () => {
    const { impl } = stubFetch({
      "wikidata.org": () => ({ body: EMPTY_SEARCH }),
      "contoso.com": () => ({ body: htmlPage("Domain For Sale") }),
    });
    const res = await resolveCandidateDomain("Contoso", { fetchImpl: impl });
    expect(res.domain).toBeNull();
    expect(res.via).toBe("unresolved");
    expect(res.live).toBe(true);
  });

  it("returns unresolved when the slug host does not answer", async () => {
    const { impl } = stubFetch({ "wikidata.org": () => ({ body: EMPTY_SEARCH }) });
    const res = await resolveCandidateDomain("No Such Label", { fetchImpl: impl });
    expect(res).toEqual({ domain: null, via: "unresolved", live: false });
  });

  it("serves a repeat resolution from KV without touching the network", async () => {
    const { impl, calls } = stubFetch({
      "wbsearchentities": () => ({ body: WIKIDATA_SEARCH_HIT }),
      "wbgetentities": () => ({ body: WIKIDATA_P856 }),
      "gymshark.com": () => ({ body: htmlPage("Gymshark") }),
    });
    const first = await resolveCandidateDomain("Gymshark", {
      kv: env.RESOLVE_CACHE,
      fetchImpl: impl,
    });
    const callCount = calls.length;
    const second = await resolveCandidateDomain("Gymshark", {
      kv: env.RESOLVE_CACHE,
      fetchImpl: impl,
    });
    expect(second).toEqual(first);
    expect(calls.length).toBe(callCount);
  });
});

describe("slugFor", () => {
  it("squashes the candidate name to a bare host stem", () => {
    expect(slugFor("Alphalete Athletics")).toBe("alphaleteathletics");
    expect(slugFor("Alo Yoga")).toBe("aloyoga");
    expect(slugFor("Nike, Inc.")).toBe("nikeinc");
  });
});
