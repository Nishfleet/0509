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
      <PublicDocBlock title="2026-08-30">
        <ul className="f9-doc-list">
          <li>Cold searches on /search now show a tier-progress row on first load — &quot;N verified · M checking&quot; — so visitors see what we already know while the verify pass keeps running in the background, instead of staring at a blank warming state.</li>
          <li>A new /compare hub page lists every comparison against Visualping, Panoramata, Foreplay, MagicBrief, and the other alternatives, so visitors can scan them all from one place instead of finding each one by search.</li>
        </ul>
      </PublicDocBlock>

      <PublicDocBlock title="2026-08-29">
        <ul className="f9-doc-list">
          <li>Brand pages at /ads/:domain now correctly attribute brand-owned ads on regional stores — e.g. ridgewallet.ca, sugarcosmetics.com, hm.com — so a brand page no longer reads &quot;0 verified&quot; when the brand&apos;s own ads are landing on its own regional site.</li>
          <li>Bare keyword searches (like &quot;nike&quot; or &quot;nykaa&quot;) now carry the same Verified / Likely / Unmatched labels that domain searches do, so visitors can tell which keyword results were actually verified.</li>
          <li>The capture-validity rules now live at /capture-rules; old /proof links 301 to the new page, so every old share and bookmark still lands on the right place.</li>
        </ul>
      </PublicDocBlock>

      <PublicDocBlock title="2026-08-28">
        <ul className="f9-doc-list">
          <li>Landing-page monitoring now gates alerts on a capture-validity classifier — bot walls, cookie walls, partial loads, error pages, and uncorroborated extracts never fire a phantom-change alert.</li>
          <li>The watchlists board now shows a Suggested competitors panel, with every proposal marked &quot;Suggested · unverified&quot; until you accept it — nothing is added to your watchlist automatically.</li>
          <li>Mention monitoring now re-sweeps RSS and Atom feeds on a daily cadence, and the digest marks first-observed-in-window mentions with &quot;(new)&quot;, so recurring coverage does not drown out new ones.</li>
          <li>A new Mentions panel on the entity page lists every RSS mention we have seen, with honest empty states when nothing has surfaced yet.</li>
          <li>Auto-competitor discovery now re-runs on a cadence and surfaces only net-new advertisers as &quot;newly appeared&quot; candidates, so a brand you already watch or already dismissed never comes back as a suggestion.</li>
          <li>Full-site watch now classifies careers and legal / policy pages as first-class page kinds, so a hiring change or a privacy-policy update shows up as a real signal instead of being labeled &quot;about&quot; or &quot;other&quot;.</li>
          <li>Brand pages at /ads/:domain now carry FAQ structured data and a visible FAQ section, so search engines can show rich results for competitor-ad queries on each brand.</li>
          <li>The Visualping and Foreplay comparison pages now carry FAQ structured data, so search engines can show rich results for those queries.</li>
          <li>Every /compare/* page now lists the first-party sources behind each claim, with inline &quot;Source:&quot; links and an &quot;Every claim on this page has a link&quot; footer, so readers can verify any claim on the page.</li>
          <li>Brand pages no longer promise a screenshot on every watch — the copy now reads &quot;a screenshot when the capture includes one&quot;, matching the rest of the public surfaces.</li>
          <li>First-brief-on-signup is now enabled: a new user sees an in-session brief with evidence within five minutes of signing up, instead of waiting up to a week for the next weekly digest.</li>
          <li>Empty brand pages (cache-miss) now 301 to /search?q=&lt;domain&gt; instead of showing a soft-404 shell, so visitors never hit a dead end on a brand we have never watched.</li>
          <li>The run history now lists every capture — including failed and skipped — with a public reason code (bot_wall, cookie_banner, budget_skip, and others), so customers can see why a check did not alert.</li>
          <li>Budget-skipped captures now surface as &quot;evidence skipped (budget)&quot; in the digest and watchlist record, so a paid plan never silently reports &quot;all quiet&quot; when the allowance was reached.</li>
          <li>Timeline pages no longer render backfill rows that lack a screenshot or page-text artifact, so a public timeline never promises a screenshot it cannot keep.</li>
          <li>The proof brief timeline now says &quot;Creative on record since &lt;date&gt;&quot; for old captures (instead of &quot;Creative started running &lt;date&gt;&quot;), and the decision card no longer claims a long-running ad was &quot;captured today&quot; — the only &quot;captured today&quot; stamp on the page is the honest header-level fetch time.</li>
          <li>/switch pages now cite a verified public complaint at the top, end in a single primary CTA to the free /search preview, and use SEO titles tuned for the non-branded queries they target.</li>
        </ul>
      </PublicDocBlock>

      <PublicDocBlock title="2026-08-27">
        <ul className="f9-doc-list">
          <li>The homepage hero proof strip now flips its &quot;Live proof&quot; chip to &quot;On record&quot; when the underlying capture is older than 30 days, so the chip and the timestamp agree.</li>
          <li>Bare keyword searches like ?q=goat now report &quot;N unverified keyword matches&quot; with a next-action link to the verified domain search, instead of presenting an unrelated company match as proof.</li>
          <li>Google sitelinks to the homepage search bar now run a real query and land on a search page that names the brand in the heading, instead of bouncing on an incomplete-domain error.</li>
          <li>Brand pages at /ads/:domain now use the public brand name in titles and headings — Allbirds, Bombay Shaving Company, Sugar Cosmetics, ASOS, HubSpot, Ridge Wallet — so search engines and visitors see the name they recognise, not a collapsed host label.</li>
          <li>The plan grid no longer badges Starter as &quot;Recommended&quot; for paying customers, and the picker reads &quot;Switch&quot; instead of &quot;Select&quot; once you have a paid plan, so the wording matches what the button actually does.</li>
          <li>The signed-in workspace now caps its working page measure on wide windows so label / value pairs sit close together, and the plan CTA no longer washes out in dark mode.</li>
          <li>Timeline pages for the 25 sitemap brands are now populated with at least one dated entry, and any future unseeded brand returns 410 instead of an empty shell.</li>
        </ul>
      </PublicDocBlock>

      <PublicDocBlock title="2026-08-26">
        <ul className="f9-doc-list">
          <li>A public page at /proof now lists the landing-page captures we refuse to turn into alerts, linked from the homepage proof claim.</li>
          <li>Brand pages at /ads/:domain now headline the verified ad count, so leftover unverified matches no longer rewrite a fully brand-owned title into a split count.</li>
          <li>Restored compare pages reappear in the sitemap and llms.txt index, so search engines and AI answer engines can find them again.</li>
          <li>Shared search result pages now show the brand name and country, so recipients see which market the snapshot covers before they open it.</li>
          <li>The /pricing and /ads public pages now carry a single plain-text h1 heading, so screen readers and search engines read one clear page title.</li>
          <li>The homepage proof wall no longer shows stale capture dates, so the freshness signal stays honest.</li>
          <li>The Ad Aggression Score now has its own public formula page, linked from every brand ads page, so anyone can see how the 0–100 number is computed.</li>
        </ul>
      </PublicDocBlock>

      <PublicDocBlock title="2026-08-25">
        <ul className="f9-doc-list">
          <li>The public pricing page now displays real plan prices and keeps the annual toggle working, so visitors can switch between monthly and yearly billing and see the matching price.</li>
          <li>The landing-page proof flag now stays inside its row on desktop and on phones, instead of poking past the edge of the page.</li>
          <li>On phones, sign-in and sign-up now keep the brand name and headline beside the form, and the Search footer no longer clips Help.</li>
        </ul>
      </PublicDocBlock>

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
