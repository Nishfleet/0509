import { afterEach, describe, expect, it, vi } from "vitest";

import { robotsAllows } from "../../app/lib/fetch/robots.server";
import { breakageRepaired, probeOwnSite } from "../../app/lib/site/own-site.server";

const REFUSED = [
  "http://169.254.169.254/latest/meta-data/",
  "http://127.0.0.1/admin",
  "http://metadata.google.internal/",
  "http://localhost/",
];

function redirectingTo(location: string, origin: string) {
  const seen: string[] = [];
  const inits: RequestInit[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    seen.push(url);
    if (init) inits.push(init);
    if (url.startsWith(origin)) {
      return Promise.resolve(new Response(null, { status: 302, headers: { location } }));
    }
    return Promise.reject(new Error(`unexpected outbound fetch: ${url}`));
  });
  return { seen, inits };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("robotsAllows redirect guard", () => {
  it.each(REFUSED)("does not follow a robots.txt redirect to %s", async (location) => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const stub = redirectingTo(location, "https://brand.example.com/");
    expect(await robotsAllows("https://brand.example.com/pricing")).toBe(true);
    expect(stub.seen).toEqual(["https://brand.example.com/robots.txt"]);
    expect(stub.inits.every((init) => init.redirect === "manual")).toBe(true);
  });
});

describe("own-site redirect guard", () => {
  it.each(REFUSED)("probeOwnSite refuses a redirect to %s without fetching it", async (location) => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const stub = redirectingTo(location, "https://brand.example.com/");
    expect(await probeOwnSite("https://brand.example.com/")).toEqual({
      state: "unknown",
      reason: "redirect refused",
    });
    expect(stub.seen).toEqual(["https://brand.example.com/robots.txt", "https://brand.example.com/"]);
    expect(stub.inits.every((init) => init.redirect === "manual")).toBe(true);
  });

  it.each(REFUSED)("breakageRepaired refuses a redirect to %s without fetching it", async (location) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const stub = redirectingTo(location, "https://brand.example.com/");
    expect(await breakageRepaired("https://brand.example.com/", "snapshot-key")).toBe(false);
    expect(stub.seen).toEqual(["https://brand.example.com/"]);
  });
});
