import { describe, expect, it } from "vitest";

import { afterEach, beforeEach, vi } from "vitest";

type LoaderArgs = { request: Request };

function loadLoader(module: string) {
  return import(module).then((m) => m.loader as (args: LoaderArgs) => Promise<Response>);
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

// Loaders express redirects by throwing the Response (React Router contract).
// These loaders throw synchronously, so defer the call into a promise chain to
// capture the thrown redirect the same way the auth suites do.
async function runLoader(module: string, url = "https://0509.io/sample-brief") {
  const loader = await loadLoader(module);
  return (await Promise.resolve().then(() =>
    loader({ request: new Request(url) }),
  ).catch((error) => error)) as Response;
}

// The 2026-07-20 public-home rebuild moved the sample brief and pricing into
// homepage sections (/#demo, /#pricing); the nav and CTAs point at those
// anchors. Legacy paths must 301 there instead of 404 so old links, emails,
// and search hits keep working (sol-sweep packet
// product-live/0509-sample-brief-and-pricing-public-routes-404).
describe("legacy public marketing redirect routes", () => {
  it("redirects /sample-brief to the homepage demo anchor", async () => {
    const response = await runLoader("~/routes/sample-brief");
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://0509.io/#demo");
  });

  it("redirects /pricing to the homepage pricing anchor", async () => {
    const response = await runLoader("~/routes/pricing", "https://0509.io/pricing");
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://0509.io/#pricing");
  });

  it("redirects /plans to the homepage pricing anchor", async () => {
    const response = await runLoader("~/routes/plans", "https://0509.io/plans");
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://0509.io/#pricing");
  });

  it("resolves against the requesting origin so any host redirects in place", async () => {
    const loader = await loadLoader("~/routes/sample-brief");
    const response = (await Promise.resolve().then(() =>
      loader({ request: new Request("https://www.0509.io/sample-brief") }),
    ).catch((error) => error)) as Response;
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://www.0509.io/#demo");
  });

  it("keeps the canonical homepage declared as the index route", async () => {
    const { default: routes } = await import("../app/routes");
    const index = routes.find((r) => r.index === true);
    expect(index).toBeDefined();
    expect(index?.file).toBe("routes/marketing.tsx");
  });

  it("keeps the compare pages and legacy redirects declared as routes", async () => {
    const { default: routes } = await import("../app/routes");
    const paths = routes.map((r) => r.path).filter((p): p is string => typeof p === "string");
    expect(paths).toContain("compare/magicbrief");
    expect(paths).toContain("compare/meta-ad-library");
    expect(paths).toContain("sample-brief");
    expect(paths).toContain("pricing");
    expect(paths).toContain("plans");
  });
});
