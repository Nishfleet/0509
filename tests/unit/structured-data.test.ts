import { readFileSync } from "node:fs";

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
      logo: "https://0509.io/logo.svg",
    });
    expect(node).not.toHaveProperty("sameAs");
    expect(node).not.toHaveProperty("aggregateRating");
  });

  it("ships a square logo of at least 112px in public/", () => {
    const svg = readFileSync(new URL("../../public/logo.svg", import.meta.url), "utf8");
    const dimensions = svg.match(/width="(\d+)"[^>]*height="(\d+)"/);
    expect(dimensions).not.toBeNull();
    const width = Number(dimensions?.[1]);
    const height = Number(dimensions?.[2]);
    expect(width).toBe(height);
    expect(width).toBeGreaterThanOrEqual(112);
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
