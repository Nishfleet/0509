import type { Route } from "./+types/landing";

import { Footer } from "../components/footer";
import { Agents } from "../components/landing/agents";
import { Faq } from "../components/landing/faq";
import { Header } from "../components/landing/header";
import { Hero } from "../components/landing/hero";
import { HowItWorks } from "../components/landing/how-it-works";
import { Price } from "../components/landing/price";
import { pageWidth } from "../components/landing/section";
import { TheMark } from "../components/landing/the-mark";
import { WhatWeWatch } from "../components/landing/what-we-watch";
import { FAQ } from "../lib/faq";
import {
  SITE_URL,
  faqPageJsonLd,
  jsonLdGraph,
  organizationJsonLd,
  softwareApplicationJsonLd,
  websiteJsonLd,
} from "../lib/structured-data";

const TITLE = "Competitor tracking for founders and creators | Five to Nine";
const DESCRIPTION =
  "Five to Nine watches your competitors' ads, website changes, mentions and hiring, and emails you one brief every Monday with a screenshot behind every change.";
const HOME = `${SITE_URL}/`;

export function meta(_: Route.MetaArgs) {
  return [
    { title: TITLE },
    { name: "description", content: DESCRIPTION },
    { tagName: "link", rel: "canonical", href: HOME },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "Five to Nine" },
    { property: "og:title", content: TITLE },
    { property: "og:description", content: DESCRIPTION },
    { property: "og:url", content: HOME },
    { property: "og:image", content: `${SITE_URL}/og.png` },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: "Know where you stand. And who's gaining on you." },
    { name: "twitter:card", content: "summary_large_image" },
    {
      "script:ld+json": jsonLdGraph([
        organizationJsonLd(),
        websiteJsonLd(),
        softwareApplicationJsonLd(),
        faqPageJsonLd(FAQ),
      ]),
    },
  ];
}

export default function Landing() {
  return (
    <div className="bg-bone text-ink">
      <Header />
      <main>
        <Hero />
        <TheMark />
        <HowItWorks />
        <WhatWeWatch />
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
