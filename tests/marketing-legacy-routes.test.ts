import { describe, expect, it } from "vitest";

// sol-sweep defect product-live/0509-sample-brief-and-pricing-public-routes-404:
// /sample-brief and /pricing must never serve the 404 page. The routes were
// removed in the May 2026 home rebuild; the homepage still advertises the
// sections as #demo and #pricing anchors, and old marketing emails, share
// links, and search engines still point at the full paths. These tests fail
// if the redirect loaders disappear (no loader => 404 via the catch-all).
//
// react-router's redirect() throws a Response whose static props (status,
// headers) live on the prototype, not as instance properties, in this build —
// read them through the prototype getters bound to the instance.
const responseStatus = (error: unknown) => {
  const proto = Object.getPrototypeOf(error) as { status?: number } | null;
  const getter = proto && Object.getOwnPropertyDescriptor(proto, "status")?.get;
  return getter?.call(error);
};
const responseLocation = (error: unknown) => {
  const proto = Object.getPrototypeOf(error) as { headers?: Headers } | null;
  const getter = proto && Object.getOwnPropertyDescriptor(proto, "headers")?.get;
  return getter?.call(error)?.get("location");
};

describe("legacy marketing route redirects", () => {
  it("301s /sample-brief to the homepage #demo anchor", async () => {
    const { loader } = await import("~/routes/marketing.sample-brief");
    let caught: unknown;
    try {
      await loader({
        request: new Request("https://0509.io/sample-brief?utm_source=email"),
      } as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(responseStatus(caught)).toBe(301);
    expect(responseLocation(caught)).toBe("/#demo?utm_source=email");
  });

  it("301s /pricing to the homepage #pricing anchor", async () => {
    const { loader } = await import("~/routes/marketing.pricing");
    let caught: unknown;
    try {
      await loader({
        request: new Request("https://0509.io/pricing"),
      } as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(responseStatus(caught)).toBe(301);
    expect(responseLocation(caught)).toBe("/#pricing");
  });
});
