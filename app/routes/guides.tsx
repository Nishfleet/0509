/**
 * /guides — the index of the live /guides/* how-to cluster (issue #2885).
 *
 * The sitemap lists two /guides/* pages, but the parent /guides path 404'd:
 * a crawler or reader who climbed one level up from a guide hit a dead end.
 * This hub renders a thin listing of the live children — no new content —
 * so the section parent resolves 200 and the cluster is internally linked.
 */

import { Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { MarketingFooter } from "~/components/marketing-footer";
import { MarketingNav } from "~/components/marketing-nav";
import {
  canonicalLinks,
  itemListJsonLd,
  jsonLdScriptProps,
  publicSeoMeta,
} from "~/lib/seo";

import "~/styles/marketing.css";
const PATHNAME = "/guides";

export const links: LinksFunction = () => canonicalLinks(PATHNAME);

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Guides: track and monitor competitor ads | Five to Nine",
    description:
      "The how-to guides: track competitor ads by hand, monitor a competitor's Meta Ad Library over time, and watch a landing page for offer/price/CTA changes — all ending in the free no-account search preview.",
    pathname: PATHNAME,
  });

/** The live /guides/* children. Must stay in lockstep with the
 * /guides/* entries in SITEMAP_PATHS (pinned by tests/section-parents.test.ts).
 */
export const GUIDE_ENTRIES = [
  {
    href: "/guides/how-to-track-competitor-ads",
    title: "How to track competitor ads",
    blurb:
      "The honest manual/DIY/automated walkthrough for the tracking workflow, ending in the free no-account search preview.",
  },
  {
    href: "/guides/how-to-monitor-meta-ad-library",
    title: "How to monitor a competitor's Meta Ad Library",
    blurb:
      "The watch-over-time routine: find the Ad Library URL, pick a check cadence, log what runs — and where monitoring by hand breaks.",
  },
  {
    href: "/guides/how-to-monitor-competitor-landing-page-changes",
    title: "How to monitor a competitor's landing-page changes",
    blurb:
      "The offer/price/CTA watch the two ad guides don't cover: URL + condition by hand, where pixel diffs break, and the semantic-diff routine.",
  },
] as const;

export default function GuidesIndex() {
  const itemListJsonLdValue = itemListJsonLd(
    GUIDE_ENTRIES.map((guide) => ({ name: guide.title, pathname: guide.href })),
  );
  return (
    <div className="min-h-dvh bg-neutral-50 text-neutral-900">
      <script {...jsonLdScriptProps(itemListJsonLdValue)} />
      <MarketingNav />
      <main className="mx-auto max-w-3xl px-4 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">Guides</h1>
        <p className="mt-3 text-neutral-600">
          How-to guides for tracking competitor ads and watching competitor
          pages change over time.
        </p>
        <ul className="mt-10 space-y-6">
          {GUIDE_ENTRIES.map((guide) => (
            <li key={guide.href} className="border-b border-neutral-200 pb-6">
              <Link
                to={guide.href}
                className="text-lg font-medium text-neutral-900 underline decoration-neutral-300 hover:decoration-neutral-900"
              >
                {guide.title}
              </Link>
              <p className="mt-1 text-sm text-neutral-600">{guide.blurb}</p>
            </li>
          ))}
        </ul>
      </main>
      <MarketingFooter />
    </div>
  );
}
