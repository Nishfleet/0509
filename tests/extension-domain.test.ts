import { describe, expect, it } from "vitest";

// The Chrome extension is intentionally decoupled from the app build; this
// test only exercises its one pure module (no browser APIs, no app imports).
// extension/lib is included in tsconfig.node.json so checkJs covers it here.
import {
  buildDestinations,
  domainFromInput,
  domainFromTabUrl,
  normalizeHostname,
} from "../extension/lib/domain.mjs";

describe("extension domain normalization", () => {
  it("extracts and normalizes the hostname from http(s) tab URLs", () => {
    expect(domainFromTabUrl("https://www.acme.com/pricing?ref=x")).toBe("acme.com");
    expect(domainFromTabUrl("http://Sub.Brand.CO.uk/")).toBe("sub.brand.co.uk");
    expect(domainFromTabUrl("https://acme.com.")).toBe("acme.com");
  });

  it("rejects non-http(s) tabs so the popup falls back to manual entry", () => {
    expect(domainFromTabUrl("chrome://extensions")).toBeNull();
    expect(domainFromTabUrl("file:///Users/nish/index.html")).toBeNull();
    expect(domainFromTabUrl("about:blank")).toBeNull();
    expect(domainFromTabUrl("chrome-extension://abc/popup.html")).toBeNull();
    expect(domainFromTabUrl(undefined)).toBeNull();
    expect(domainFromTabUrl("")).toBeNull();
    expect(domainFromTabUrl("not a url")).toBeNull();
  });

  it("rejects hosts that are not plausible public domains", () => {
    expect(domainFromTabUrl("https://localhost:3000")).toBeNull();
    expect(normalizeHostname("no-dots")).toBeNull();
    expect(normalizeHostname("bad_.chars.com")).toBeNull();
    expect(normalizeHostname("")).toBeNull();
  });

  it("strips only a single leading www label", () => {
    expect(normalizeHostname("www.acme.com")).toBe("acme.com");
    expect(normalizeHostname("www.www.acme.com")).toBe("www.acme.com");
    expect(normalizeHostname("wwwacme.com")).toBe("wwwacme.com");
  });

  it("normalizes free-typed input with or without scheme and path", () => {
    expect(domainFromInput("acme.com")).toBe("acme.com");
    expect(domainFromInput("  https://www.acme.com/ads  ")).toBe("acme.com");
    expect(domainFromInput("WWW.ACME.COM")).toBe("acme.com");
    expect(domainFromInput("")).toBeNull();
    expect(domainFromInput("   ")).toBeNull();
    expect(domainFromInput("chrome://extensions")).toBeNull();
  });

  it("builds properly encoded Five to Nine destination URLs", () => {
    const urls = buildDestinations("acme.com");
    expect(urls.ads).toBe("https://0509.io/ads/acme.com");
    expect(urls.search).toBe("https://0509.io/search?website=https%3A%2F%2Facme.com");
    expect(urls.watch).toBe(
      "https://0509.io/auth/signup?redirectTo=%2Fapp%3Fwebsite%3Dhttps%253A%252F%252Facme.com%23setup-checklist",
    );
  });

  it("round-trips the watch redirect through double decoding", () => {
    const urls = buildDestinations("acme.com");
    const redirectTo = new URL(urls.watch).searchParams.get("redirectTo");
    expect(redirectTo).toBe("/app?website=https%3A%2F%2Facme.com#setup-checklist");
    const website = new URL(redirectTo!, "https://0509.io").searchParams.get("website");
    expect(website).toBe("https://acme.com");
  });
});
