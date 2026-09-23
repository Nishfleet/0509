export const SITE_URL = "https://0509.io";

export function organizationJsonLd() {
  return {
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: "Five to Nine",
    url: SITE_URL,
  };
}

export function breadcrumbJsonLd(items: readonly { name: string; path: string }[]) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: SITE_URL + item.path,
    })),
  };
}

export function jsonLdGraph(nodes: readonly object[]) {
  return { "@context": "https://schema.org", "@graph": nodes };
}
