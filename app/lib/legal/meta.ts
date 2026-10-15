import type { LegalDocument } from "./document";
import { SITE_URL, breadcrumbJsonLd, shareImageMeta, jsonLdGraph, organizationJsonLd } from "../structured-data";

export function legalMeta(doc: LegalDocument) {
  const title = `${doc.title} · Five to Nine`;
  return [
    { title },
    { name: "description", content: doc.description },
    { name: "robots", content: "index, follow" },
    { tagName: "link", rel: "canonical", href: `${SITE_URL}${doc.path}` },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "Five to Nine" },
    { property: "og:title", content: title },
    { property: "og:description", content: doc.description },
    { property: "og:url", content: `${SITE_URL}${doc.path}` },
    ...shareImageMeta(),
    {
      "script:ld+json": jsonLdGraph([
        organizationJsonLd(),
        breadcrumbJsonLd([
          { name: "Five to Nine", path: "/" },
          { name: doc.title, path: doc.path },
        ]),
      ]),
    },
  ];
}
