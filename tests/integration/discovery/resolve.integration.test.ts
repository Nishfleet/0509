import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";

import { resolveDomain } from "../../../app/lib/discovery/resolve-domain";

afterEach(() => {
  vi.unstubAllGlobals();
});

const NOT_FOUND = () => Promise.resolve(new Response("not found", { status: 404 }));

describe("resolveDomain", () => {
  it("resolves Gymshark through the Wikidata P856 claim and caches it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("wbsearchentities")) {
          return Promise.resolve(Response.json({ search: [{ id: "Q123" }] }));
        }
        if (url.includes("wbgetentities")) {
          return Promise.resolve(
            Response.json({
              entities: {
                Q123: {
                  claims: {
                    P856: [
                      {
                        mainsnak: {
                          datavalue: { value: "https://www.gymshark.com" },
                        },
                      },
                    ],
                  },
                },
              },
            }),
          );
        }
        return NOT_FOUND();
      }),
    );

    await expect(resolveDomain("Gymshark", env.RESOLVE_CACHE)).resolves.toEqual({
      domain: "gymshark.com",
      via: "wikidata",
    });
    await expect(env.RESOLVE_CACHE.get("resolve:gymshark", "json")).resolves.toEqual({
      domain: "gymshark.com",
      via: "wikidata",
    });
  });

  it("accepts a slug guess only on an exact og:site_name match", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("wbsearchentities")) {
          return Promise.resolve(Response.json({ search: [] }));
        }
        if (url.includes("alphaleteathletics.com")) {
          return Promise.resolve(
            new Response(
              '<meta property="og:site_name" content="Alphalete Athletics">',
              { status: 200, headers: { "content-type": "text/html" } },
            ),
          );
        }
        return NOT_FOUND();
      }),
    );

    await expect(resolveDomain("Alphalete Athletics", env.RESOLVE_CACHE)).resolves.toEqual({
      domain: "alphaleteathletics.com",
      via: "slug",
    });
  });

  it("rejects a parked slug that returns 200 without the name match", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("wbsearchentities")) {
          return Promise.resolve(Response.json({ search: [] }));
        }
        if (url.includes("sneakerbarn0509.com")) {
          return Promise.resolve(
            new Response('<meta property="og:site_name" content="Domain For Sale">', {
              status: 200,
              headers: { "content-type": "text/html" },
            }),
          );
        }
        return NOT_FOUND();
      }),
    );

    await expect(resolveDomain("Sneaker Barn 0509", env.RESOLVE_CACHE)).resolves.toEqual({
      domain: null,
      via: "unresolved",
    });
  });

  it("returns and caches unresolved when every step fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("wbsearchentities")) {
          return Promise.resolve(Response.json({ search: [] }));
        }
        if (url.includes("zzqxnonbrand0509.com")) {
          return Promise.reject(new Error("network"));
        }
        return NOT_FOUND();
      }),
    );

    await expect(resolveDomain("Zzqx Nonbrand 0509", env.RESOLVE_CACHE)).resolves.toEqual({
      domain: null,
      via: "unresolved",
    });
    await expect(env.RESOLVE_CACHE.get("resolve:zzqx nonbrand 0509", "json")).resolves.toEqual({
      domain: null,
      via: "unresolved",
    });
  });

  it("returns a cached Resolution without calling fetch", async () => {
    await env.RESOLVE_CACHE.put(
      "resolve:cached name 0509",
      JSON.stringify({ domain: "cached.example", via: "slug" }),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveDomain("Cached Name 0509", env.RESOLVE_CACHE)).resolves.toEqual({
      domain: "cached.example",
      via: "slug",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
