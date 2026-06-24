import { describe, expect, it } from "vitest";

import { parseSearchInput, parseSearchInputFromWebsiteField, registrableDomainFromHostname } from "~/lib/search-query";

describe("parseSearchInput domain normalization", () => {
  const domainCases: Array<[string, string, string]> = [
    ["https://okara.ai", "okara.ai", "okara.ai"],
    ["http://okara.ai", "okara.ai", "okara.ai"],
    ["okara.ai", "okara.ai", "okara.ai"],
    ["www.okara.ai", "www.okara.ai", "okara.ai"],
    ["HTTPS://WWW.OKARA.AI/", "www.okara.ai", "okara.ai"],
    ["https://app.okara.ai/path", "app.okara.ai", "okara.ai"],
    ["https://okara.ai:443/", "okara.ai", "okara.ai"],
    ["okara.ai.", "okara.ai", "okara.ai"],
    ["https://company.co.uk", "company.co.uk", "company.co.uk"],
    ["shop.company.co.uk", "shop.company.co.uk", "company.co.uk"],
    ["https://example.github.io", "example.github.io", "example.github.io"],
    ["https://пример.рф", "xn--e1afmkfd.xn--p1ai", "xn--e1afmkfd.xn--p1ai"],
    ["https://sub.domain.com.au", "sub.domain.com.au", "domain.com.au"],
    ["https://m.example.co.jp", "m.example.co.jp", "example.co.jp"],
    ["https://www.nykaa.com", "www.nykaa.com", "nykaa.com"],
    ["nykaa.com", "nykaa.com", "nykaa.com"],
    ["https://stripe.com/pricing", "stripe.com", "stripe.com"],
    ["https://app.notion.so/product", "app.notion.so", "notion.so"],
  ];

  it.each(domainCases)("parses %s as domain intent", (input, hostname, registrable) => {
    const parsed = parseSearchInput(input);
    expect(parsed.intent).toBe("domain");
    expect(parsed.hostname).toBe(hostname);
    expect(parsed.registrableDomain).toBe(registrable);
    expect(parsed.comparableHostname).toBe(hostname.replace(/^www\./, ""));
  });

  it("does not classify prose with periods as domain", () => {
    const parsed = parseSearchInput("Dr. Smith runs Nike campaigns.");
    expect(parsed.intent).toBe("text");
    expect(parsed.normalizedText).toBe("Dr. Smith runs Nike campaigns.");
  });

  it("classifies brand text as text intent", () => {
    const parsed = parseSearchInput("Notion AI");
    expect(parsed.intent).toBe("text");
    expect(parsed.normalizedText).toBe("Notion AI");
  });

  it("website field parser forces domain intent for bare hostnames", () => {
    const parsed = parseSearchInputFromWebsiteField("okara.ai");
    expect(parsed.intent).toBe("domain");
    expect(parsed.registrableDomain).toBe("okara.ai");
  });
});

describe("parseSearchInput normalization matrix", () => {
  const variants = [
    "okara.ai",
    "www.okara.ai",
    "https://okara.ai",
    "http://okara.ai",
    "HTTPS://WWW.OKARA.AI/",
    "https://app.okara.ai/path",
  ];

  it("maps okara variants to one registrable domain", () => {
    const registrable = variants.map((input) => parseSearchInputFromWebsiteField(input).registrableDomain);
    expect(new Set(registrable)).toEqual(new Set(["okara.ai"]));
  });

  const generatedCases = Array.from({ length: 100 }, (_, index) => {
    const labels = ["alpha", "beta", "gamma", "delta", "echo", "foxtrot", "golf", "hotel"];
    const tlds = ["com", "ai", "io", "co.uk", "com.au", "dev"];
    const label = labels[index % labels.length];
    const tld = tlds[index % tlds.length];
    const host = tld.includes(".") ? `${label}.${tld}` : `${label}${index}.${tld}`;
    const input = index % 3 === 0 ? `https://www.${host}/jobs` : index % 3 === 1 ? host : `http://${host}`;
    return { input, host: host.replace(/^www\./, ""), index };
  });

  it.each(generatedCases)("normalizes generated domain case $index", ({ input }) => {
    const parsed = parseSearchInput(input);
    expect(parsed.intent).toBe("domain");
    expect(parsed.registrableDomain).toBeTruthy();
    expect(parsed.normalizedUrl).toMatch(/^https?:\/\//);
  });
});

describe("registrableDomainFromHostname", () => {
  it("keeps multi-part public suffixes intact", () => {
    expect(registrableDomainFromHostname("shop.company.co.uk")).toBe("company.co.uk");
    expect(registrableDomainFromHostname("company.co.uk")).toBe("company.co.uk");
  });
});
