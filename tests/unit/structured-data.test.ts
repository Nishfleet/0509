import { describe, expect, it } from "vitest";

import {
  SITE_URL,
  breadcrumbJsonLd,
  jsonLdGraph,
  organizationJsonLd,
} from "../../app/lib/structured-data";

describe("SITE_URL", () => {
  it("is the canonical site origin every node builds on", () => {
    expect(SITE_URL).toBe("https://0509.io");
  });
});

describe("organizationJsonLd", () => {
  it("returns the Organization node and claims nothing unbacked", () => {
    const node = organizationJsonLd();
    expect(node).toEqual({
      "@type": "Organization",
      "@id": "https://0509.io/#organization",
      name: "Five to Nine",
      url: "https://0509.io",
      contactPoint: {
        "@type": "ContactPoint",
        contactType: "customer support",
        email: "support@0509.io",
      },
    });
    expect(node).not.toHaveProperty("logo");
    expect(node).not.toHaveProperty("sameAs");
    expect(node).not.toHaveProperty("aggregateRating");
  });
});

describe("breadcrumbJsonLd", () => {
  it("numbers the privacy crumbs 1 and 2 with absolute item URLs", () => {
    const list = breadcrumbJsonLd([
      { name: "Five to Nine", path: "/" },
      { name: "Privacy", path: "/privacy" },
    ]);
    expect(list["@type"]).toBe("BreadcrumbList");
    expect(list.itemListElement).toEqual([
      {
        "@type": "ListItem",
        position: 1,
        name: "Five to Nine",
        item: "https://0509.io/",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Privacy",
        item: "https://0509.io/privacy",
      },
    ]);
  });
});

describe("jsonLdGraph", () => {
  it("wraps nodes in the schema.org context", () => {
    const graph = jsonLdGraph([]);
    expect(graph["@context"]).toBe("https://schema.org");
    expect(graph["@graph"]).toEqual([]);
  });
});
