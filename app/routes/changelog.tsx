import type { LinksFunction, MetaFunction } from "react-router";

import { PublicDocBlock, PublicDocShell } from "~/components/public-doc-shell";
import {
  canonicalLinks,
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
} from "~/lib/seo";

const description =
  "Customer-facing updates for Five to Nine, with clear product and availability boundaries.";

export const links: LinksFunction = () => canonicalLinks("/changelog");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Changelog | Five to Nine",
    description,
    pathname: "/changelog",
  });

export default function ChangelogRoute() {
  return (
    <PublicDocShell
      kicker="Changelog"
      title="What changed in Five to Nine."
      intro="A short record of customer-visible changes. We keep planned work and unverified provider actions out until they are proven."
    >
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: "Changelog | Five to Nine",
            description,
            pathname: "/changelog",
          }),
        )}
      />
      <PublicDocBlock title="2026-08-22">
        <ul className="f9-doc-list">
          <li>Full-site watch discovery now finds and classifies pages across a competitor&apos;s whole site — not just the landing page — with a bounded crawl and per-page-type cadence, so you see changes on pricing pages, product pages, and blog posts alongside the ads you already tracked.</li>
          <li>Landing-page change detection now recognises Google Ad Manager ad-slot markers, so ad placements on publisher sites are caught as real changes instead of ignored.</li>
          <li>Watchlist monitoring now fires on real CTA and price copy changes even when the surrounding HTML churns, so pure template swaps no longer drown the signal.</li>
          <li>Ad Library captures that carry only a calendar date now render as that date — never as a midnight 12:00 AM timestamp — on brand pages, in the overview, and in digests.</li>
          <li>The homepage hero fits the first viewport without scrolling, and the proof brief loads with the real capture count visible immediately.</li>
          <li>Public search selections on the landing page now capture landing evidence anonymously, so the proof brief reflects what visitors actually looked at.</li>
          <li>Brief emails now include a retention frame on all-quiet and triage digests, and terminal first-scan runs are labelled honestly instead of headlined as &quot;queued.&quot;</li>
          <li>The sitemap now carries lastmod, changefreq, and priority on every entry, and dynamic brand-page entries carry a real lastmod from their last capture — so crawlers get an honest freshness signal instead of nothing.</li>
          <li>The llms.txt file now cites live public search and live Dodo checkout with a page link index, so AI answer engines get citable URLs instead of prose-only claims.</li>
          <li>Public copy now states the Meta-only ad scope plainly alongside multi-platform ad-library aggregators, so the honest coverage boundary is visible before signup.</li>
        </ul>
      </PublicDocBlock>

      <PublicDocBlock title="2026-08-10">
        <ul className="f9-doc-list">
          <li>The signed-in workspace was rebuilt in the landing page&apos;s visual language, with calmer layouts and one consistent style across Competitors, Overview, Search, Collections, Reports, Briefs, Presence, notifications, shares, and account settings.</li>
          <li>Workspace navigation now has five destinations — Today, Watch, Library, Deliver, and Settings — with fewer items on mobile and every member page still at its stable URL.</li>
          <li>Public search no longer stalls on a first-time query: it shows a warming state while the Ad Library capture runs in the background, and a shared search link with a query now runs that query directly.</li>
          <li>Search only promises &quot;right now&quot; results when the capture is fresh enough to prove it; on older captures it says plainly when the check ran.</li>
          <li>Brand pages at /ads/:domain now attribute every ad to its real advertiser, never label an unconfirmed creative with the brand name, and only use live wording on fresh captures.</li>
          <li>Every brief now says why the period matters, names one accountable reviewer, and gives one next action — including when a check failed or a period has no record.</li>
          <li>Monitoring periods are now told apart honestly: meaningful changes, routine activity, quiet periods, and pending or failed evidence are each named instead of being mixed into one count.</li>
          <li>Landing-page changes can show before/after evidence in the Overview and in digests when the data supports it; otherwise the page says the evidence is pending or unavailable.</li>
          <li>Monthly plan cards and the public sample brief describe only what the product currently supports; the MagicBrief migration page says exactly what it can import.</li>
          <li>The home page loads faster by fetching the pricing preview only when the pricing section nears the viewport.</li>
          <li>Visitors now see a Sign up button in the public header, and the header keeps its touch targets on small phones.</li>
        </ul>
      </PublicDocBlock>

      <PublicDocBlock title="2026-07-20">
        <ul className="f9-doc-list">
          <li>Search results now show real creative thumbnails when the Ad Library returns image or video media.</li>
          <li>Search results go deeper, with sort controls, marketing-angle chips, and variant counts when available.</li>
          <li>Signed-in fresh searches can show a grounded &quot;What to steal&quot; AI summary of the ads above.</li>
          <li>Watchlist detail now includes a Competitor Dossier with Aggression Score and, on paid plans, an AI Counter-Brief.</li>
          <li>The workspace supports dark mode via a theme toggle.</li>
          <li>Press Cmd+K (or Ctrl+K) in the workspace to quick-add a competitor watchlist.</li>
          <li>On paid plans, signed-in users can save a search result to a board from the result card.</li>
          <li>The Competitors list supports bulk pause and resume for selected watchlists.</li>
          <li>Free accounts include one weekly Competitor Watch with an activation scan and weekly email brief.</li>
          <li>Public brand pages are available at /ads/:domain for cached competitor ad snapshots.</li>
          <li>The landing page has a product FAQ, and a new compare page covers checking the Meta Ad Library by hand.</li>
          <li>Customer-facing product copy received a full voice pass for clearer, plainer language.</li>
          <li>Workspace and public pages load faster after loader parallelization and related performance work.</li>
        </ul>
      </PublicDocBlock>

      <PublicDocBlock title="2026-06-15">
        <ul className="f9-doc-list">
          <li>Updated public links and account-facing pages to use 0509.io.</li>
          <li>Clarified notification guidance so it describes what customers can confirm today.</li>
          <li>Added public help, docs, API docs, status, changelog, and trust surfaces.</li>
          <li>WhatsApp notifications are not available yet; we will update this page only after customer delivery is verified.</li>
        </ul>
      </PublicDocBlock>

      <PublicDocBlock title="2026-06-13">
        <ul className="f9-doc-list">
          <li>Billing checks now keep account access tied to confirmed payment information.</li>
          <li>Some billing actions still require account-level confirmation before they can be described as available to everyone.</li>
          <li>Slack notifications are not generally available yet; we will update this page after customer delivery is verified.</li>
        </ul>
      </PublicDocBlock>
    </PublicDocShell>
  );
}
