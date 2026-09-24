import type { LegalDocument } from "./document";
import { SITE_URL, breadcrumbJsonLd, jsonLdGraph, organizationJsonLd } from "../structured-data";

export function legalMeta(doc: LegalDocument) {
  return [
    { title: `${doc.title} · Five to Nine` },
    { name: "description", content: doc.description },
    { tagName: "link", rel: "canonical", href: `${SITE_URL}${doc.path}` },
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
