import type { LegalDocument } from "./document";
import { SITE_URL, breadcrumbJsonLd, shareImageMeta, jsonLdGraph, organizationJsonLd } from "../structured-data";

export interface PageMeta {
  readonly title: string;
  readonly description: string;
  readonly path: string;
}

export function pageMeta(page: PageMeta) {
  const title = `${page.title} · Five to Nine`;
  return [
    { title },
    { name: "description", content: page.description },
    { name: "robots", content: "index, follow" },
    { tagName: "link", rel: "canonical", href: `${SITE_URL}${page.path}` },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "Five to Nine" },
    { property: "og:title", content: title },
    { property: "og:description", content: page.description },
    { property: "og:url", content: `${SITE_URL}${page.path}` },
    ...shareImageMeta(),
    {
      "script:ld+json": jsonLdGraph([
        organizationJsonLd(),
        breadcrumbJsonLd([
          { name: "Five to Nine", path: "/" },
          { name: page.title, path: page.path },
        ]),
      ]),
    },
  ];
}

export function legalMeta(doc: LegalDocument) {
  return pageMeta(doc);
}
