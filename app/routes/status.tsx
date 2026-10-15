import type { Route } from "./+types/status";

import { StatusPage } from "../components/status-page";
import { currentStatus } from "../lib/observability/health.server";
import { SITE_URL, breadcrumbJsonLd, jsonLdGraph, organizationJsonLd, shareImageMeta } from "../lib/structured-data";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Status · Five to Nine" },
    { name: "description", content: "Whether Five to Nine is up right now." },
    { name: "robots", content: "index, follow" },
    { tagName: "link", rel: "canonical", href: `${SITE_URL}/status` },
    ...shareImageMeta(),
    {
      "script:ld+json": jsonLdGraph([
        organizationJsonLd(),
        breadcrumbJsonLd([
          { name: "Five to Nine", path: "/" },
          { name: "Status", path: "/status" },
        ]),
      ]),
    },
  ];
}

export async function loader() {
  return { working: await currentStatus(), checkedAt: new Date().toISOString() };
}

export function headers() {
  return { "Cache-Control": "public, max-age=30" };
}

export default function Status({ loaderData }: Route.ComponentProps) {
  return <StatusPage working={loaderData.working} checkedAt={loaderData.checkedAt} />;
}
