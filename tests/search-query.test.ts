import { describe, expect, it } from "vitest";

import {
  hostnamesMatchBrandCollapsedLabel,
  hostnamesMatchBrandRegionalProperty,
  hostnamesMatchBrandStemExtension,
  hostnamesMatchBrandVerifiedProperty,
  hostnamesMatchOpenCctldToGenericCommercial,
  parseSearchInput,
  parseSearchInputFromWebsiteField,
  registrableDomainFromHostname,
} from "~/lib/search-query";

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

describe("hostnamesMatchBrandRegionalProperty", () => {
  const allbirds = parseSearchInputFromWebsiteField("allbirds.com");
  const mamaearth = parseSearchInputFromWebsiteField("mamaearth.com");
  const okara = parseSearchInputFromWebsiteField("okara.ai");

  it("treats Allbirds ccTLD stores as the same brand property as allbirds.com", () => {
    expect(hostnamesMatchBrandRegionalProperty("www.allbirds.co.uk", allbirds)).toBe(true);
    expect(hostnamesMatchBrandRegionalProperty("allbirds.co.nz", allbirds)).toBe(true);
    expect(hostnamesMatchBrandRegionalProperty("allbirds.ae", allbirds)).toBe(true);
    expect(hostnamesMatchBrandRegionalProperty("allbirds.sa", allbirds)).toBe(true);
    expect(hostnamesMatchBrandRegionalProperty("allbirds.com.kw", allbirds)).toBe(true);
  });

  it("treats mamaearth.in as the regional property of mamaearth.com", () => {
    expect(hostnamesMatchBrandRegionalProperty("mamaearth.in", mamaearth)).toBe(true);
    expect(hostnamesMatchBrandRegionalProperty("www.mamaearth.in", mamaearth)).toBe(true);
  });

  it("does not treat the searched domain itself as a regional sibling", () => {
    expect(hostnamesMatchBrandRegionalProperty("allbirds.com", allbirds)).toBe(false);
    expect(hostnamesMatchBrandRegionalProperty("www.allbirds.com", allbirds)).toBe(false);
  });

  it("does not treat open ccTLDs used as generic brands as regional siblings", () => {
    const analytics = parseSearchInputFromWebsiteField("analytics.com");
    expect(hostnamesMatchBrandRegionalProperty("analytics.io", analytics)).toBe(false);
    expect(hostnamesMatchBrandRegionalProperty("analytics.ai", analytics)).toBe(false);
  });

  it("does not treat an unrelated host as a regional property", () => {
    expect(hostnamesMatchBrandRegionalProperty("eshal-clinic.example.com", okara)).toBe(false);
    expect(hostnamesMatchBrandRegionalProperty("nike.com", allbirds)).toBe(false);
  });

  it("does not widen okara.ai to okara.pk (the geography-keyword precision case)", () => {
    expect(hostnamesMatchBrandRegionalProperty("okara.pk", okara)).toBe(false);
  });
});

describe("hostnamesMatchBrandCollapsedLabel (BET 2 hugo-boss.com)", () => {
  const hugoBoss = parseSearchInputFromWebsiteField("hugo-boss.com");

  it("treats hugoboss.com as the hyphen-stripped twin of hugo-boss.com", () => {
    expect(hostnamesMatchBrandCollapsedLabel("www.hugoboss.com", hugoBoss)).toBe(true);
    expect(hostnamesMatchBrandCollapsedLabel("hugoboss.com", hugoBoss)).toBe(true);
  });

  it("does not treat the searched host itself as a collapsed twin", () => {
    expect(hostnamesMatchBrandCollapsedLabel("hugo-boss.com", hugoBoss)).toBe(false);
    expect(hostnamesMatchBrandCollapsedLabel("www.hugo-boss.com", hugoBoss)).toBe(false);
  });

  it("does not collapse unrelated brands", () => {
    expect(hostnamesMatchBrandCollapsedLabel("nike.com", hugoBoss)).toBe(false);
  });
});

describe("hostnamesMatchOpenCctldToGenericCommercial (BET 2 notion.so)", () => {
  const notion = parseSearchInputFromWebsiteField("notion.so");

  it("treats notion.com as the .com twin of a .so brand search", () => {
    expect(hostnamesMatchOpenCctldToGenericCommercial("www.notion.com", notion)).toBe(true);
    expect(hostnamesMatchOpenCctldToGenericCommercial("notion.com", notion)).toBe(true);
  });

  it("does not treat analytics.com → analytics.io as a brand twin (the open-ccTLD hole)", () => {
    const analytics = parseSearchInputFromWebsiteField("analytics.com");
    expect(hostnamesMatchOpenCctldToGenericCommercial("analytics.io", analytics)).toBe(false);
  });
});

describe("hostnamesMatchBrandStemExtension (BET 2 oura.com)", () => {
  const oura = parseSearchInputFromWebsiteField("oura.com");

  it("treats ouraring.com as a product-domain extension of oura.com", () => {
    expect(hostnamesMatchBrandStemExtension("www.ouraring.com", oura)).toBe(true);
    expect(hostnamesMatchBrandStemExtension("ouraring.com", oura)).toBe(true);
  });

  it("does not treat a 3-letter stem as an extension base (tcs.com / tcsomething.com)", () => {
    const tcs = parseSearchInputFromWebsiteField("tcs.com");
    expect(hostnamesMatchBrandStemExtension("tcsomething.com", tcs)).toBe(false);
  });

  it("does not treat an unrelated host as a stem extension", () => {
    expect(hostnamesMatchBrandStemExtension("nike.com", oura)).toBe(false);
    expect(hostnamesMatchBrandStemExtension("eshal-clinic.example.com", oura)).toBe(false);
  });
});

describe("hostnamesMatchBrandVerifiedProperty", () => {
  it("unions regional, collapsed-label, and open-ccTLD twins", () => {
    const allbirds = parseSearchInputFromWebsiteField("allbirds.com");
    const hugoBoss = parseSearchInputFromWebsiteField("hugo-boss.com");
    const notion = parseSearchInputFromWebsiteField("notion.so");
    expect(hostnamesMatchBrandVerifiedProperty("allbirds.co.uk", allbirds)).toBe(true);
    expect(hostnamesMatchBrandVerifiedProperty("hugoboss.com", hugoBoss)).toBe(true);
    expect(hostnamesMatchBrandVerifiedProperty("notion.com", notion)).toBe(true);
  });
});
