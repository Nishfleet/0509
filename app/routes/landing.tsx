import type { Route } from "./+types/landing";

import { env } from "cloudflare:workers";

import { Footer } from "../components/footer";
import { Agents } from "../components/landing/agents";
import { Faq } from "../components/landing/faq";
import { Header } from "../components/landing/header";
import { Hero } from "../components/landing/hero";
import { HowItWorks } from "../components/landing/how-it-works";
import { Marks } from "../components/landing/marks";
import { Price } from "../components/landing/price";
import { pageWidth } from "../components/landing/section";
import { Ticker } from "../components/landing/ticker";
import { WhatWeWatch } from "../components/landing/what-we-watch";
import { readSiteChanges } from "../lib/data/signal.server";
import { readRegistrySources } from "../lib/data/source.server";
import { FAQ } from "../lib/faq";
import { landingSources } from "../lib/landing-sources";
import { daysBefore, readLandingMarks } from "../lib/site-changes.server";
import { MAIN_CONTENT_ID, SkipLink } from "../components/skip-link";
import {
  SITE_URL,
  faqPageJsonLd,
  jsonLdGraph,
  organizationJsonLd,
  shareImageMeta,
  softwareApplicationJsonLd,
  websiteJsonLd,
} from "../lib/structured-data";
import { tickerItems } from "../lib/ticker";
import { watchedClaims } from "../lib/watched-claims";

const PAGE_TITLE = "Competitor tracking for founders and creators | Five to Nine";
function description(nouns: string): string {
  return `Five to Nine watches your competitors' ${nouns} and emails you one brief every Monday with a screenshot behind every change.`;
}
const HOME = `${SITE_URL}/`;

export function meta({ loaderData }: Route.MetaArgs) {
  const claims = loaderData?.claims ?? watchedClaims([], 0);
  const summary = description(claims.nouns);
  return [
    { title: PAGE_TITLE },
    { name: "description", content: summary },
    { tagName: "link", rel: "canonical", href: HOME },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "Five to Nine" },
    { property: "og:title", content: PAGE_TITLE },
    { property: "og:description", content: summary },
    { property: "og:url", content: HOME },
    ...shareImageMeta(),
    {
      "script:ld+json": jsonLdGraph([
        organizationJsonLd(),
        websiteJsonLd(),
        softwareApplicationJsonLd(claims.features),
        faqPageJsonLd(FAQ),
      ]),
    },
  ];
}

export async function loader(_: Route.LoaderArgs) {
  const now = Date.now();
  const registry = await readRegistrySources();
  const sources = landingSources(registry, now);
  const claims = watchedClaims(registry, now);
  const marks = await readLandingMarks(new Date(now));
  const id: unknown = env.LANDING_WORKSPACE_ID;
  if (typeof id !== "string" || id.trim() === "") return { ticker: [], marks, sources, claims, now };
  const rows = await readSiteChanges({
    workspaceId: id.trim(),
    entityId: null,
    since: daysBefore(new Date(now), 7),
    limit: 24,
  });
  return { ticker: tickerItems(rows, new Date(now)), marks, sources, claims, now };
}

export default function Landing({ loaderData }: Route.ComponentProps) {
  return (
    <div className="bg-bone text-ink">
      <SkipLink />
      <Ticker items={loaderData.ticker} />
      <Header />
      <main id={MAIN_CONTENT_ID} tabIndex={-1}>
        <Hero nouns={loaderData.claims.nouns} />
        <Marks marks={loaderData.marks} now={loaderData.now} />
        <HowItWorks />
        <WhatWeWatch sources={loaderData.sources} now={loaderData.now} />
        <Agents />
        <Price />
        <Faq />
      </main>
      <div className={`${pageWidth} pb-12`}>
        <Footer />
      </div>
    </div>
  );
}
