import type { DemoBrandPageDomain } from "~/lib/demo-brand-pages";
import { FREE_PREVIEW_SEARCH_DOMAIN } from "~/lib/demo-brand-pages";
import type { FaqJsonLdEntry } from "~/lib/seo";

export type SwitchSlug = "panoramata" | "visualping" | "magicbrief" | "adspy";

export type PublishedCaptureValidityReasonCode =
  | "landing_challenge_page"
  | "landing_cookie_wall"
  | "landing_partial_spa"
  | "landing_error_page"
  | "landing_content_signature_too_small";

export interface SwitchSource {
  href: string;
  label: string;
  checked: string;
}

export interface SwitchCopyBlock {
  title: string;
  detail: string;
}

export interface SwitchPage {
  slug: SwitchSlug;
  productName: string;
  pathname: `/switch/${SwitchSlug}`;
  title: string;
  description: string;
  ctaBrand: string;
  /**
   * Domain the free-preview CTA searches (issue 2123). A tracked demo brand
   * whose production /search returns verified ads — never this page's own
   * vendor domain, which renders "0 ads found". Copy may still name the
   * vendor; the search query must be the demo competitor.
   */
  previewSearchDomain?: DemoBrandPageDomain;
  kicker: string;
  headline: string;
  deck: string;
  // One honest, source-grounded line for the /search cross-link card (issue
  // 1554). Scoped to what this page's own copy already claims — never new
  // promises. Rendered on /search above the fold for a matching switch
  // target so the first-value moment hands off to the /switch/* destination.
  cardLine: string;
  complaint: {
    kicker: string;
    heading: string;
    quote: string;
    source: SwitchSource;
  };
  furtherSources: readonly SwitchSource[];
  transfers: readonly SwitchCopyBlock[];
  doesNotTransfer: readonly SwitchCopyBlock[];
  relatedComparePath: `/compare/${string}` | null;
  extraSection: {
    kicker: string;
    heading: string;
    items: readonly SwitchCopyBlock[];
  } | null;
  // FAQ entries answer the high-intent "<product> alternative" queries these
  // switch pages target (BET 8). Every answer is grounded in this page's own
  // copy — nothing new promised — and is emitted both as visible FAQ copy and
  // as FAQPage JSON-LD from the same array (single source of truth, mirroring
  // the /compare/* pages).
  faqEntries: ReadonlyArray<FaqJsonLdEntry>;
}

export const NO_PHANTOM_CHANGE_RULES: ReadonlyArray<
  SwitchCopyBlock & { reasonCode: PublishedCaptureValidityReasonCode }
> = [
  {
    reasonCode: "landing_error_page",
    title: "Error and down pages",
    detail:
      "HTTP 4xx/5xx responses, and thin bodies that are only error or maintenance copy, never become an alert.",
  },
  {
    reasonCode: "landing_challenge_page",
    title: "Anti-bot challenge walls",
    detail:
      "A Cloudflare-style interstitial or other verification wall is recorded as a failed capture, not a page change.",
  },
  {
    reasonCode: "landing_cookie_wall",
    title: "Consent walls that hide the page",
    detail:
      "A cookie banner that gates the real content, or a banner with almost no real page underneath, is not an alert.",
  },
  {
    reasonCode: "landing_partial_spa",
    title: "Empty JavaScript shells",
    detail:
      "An unhydrated app root or an enable-JavaScript notice with no meaningful body is a failed capture, not a change.",
  },
  {
    reasonCode: "landing_content_signature_too_small",
    title: "Bodies too thin to be the real page",
    detail:
      "If the visible text is too small to be a real landing page, we refuse to treat it as a change.",
  },
];

export const SWITCH_PAGES: Record<SwitchSlug, SwitchPage> = {
  panoramata: {
    slug: "panoramata",
    productName: "Panoramata",
    pathname: "/switch/panoramata",
    title: "Panoramata alternative | Five to Nine",
    description:
      "A verified reviewer says Panoramata's price feels high for a solo marketer. Paste a domain for the same ads and pages job. Try the free preview.",
    ctaBrand: "panoramata.co",
    previewSearchDomain: FREE_PREVIEW_SEARCH_DOMAIN,
    kicker: "Switch from Panoramata",
    headline: "Same ads and pages job. Paste a domain.",
    deck: "A verified GetApp reviewer says Panoramata's price feels a bit high for a solo marketer. Five to Nine does the same public Meta ads and landing-page job from a pasted domain.",
    cardLine: "Panoramata's price felt high for solo. Same public Meta ads and landing-page job from a pasted domain.",
    complaint: {
      kicker: "The public record",
      heading: "Same ads and pages job.",
      quote:
        "Price feels a bit high if you're a solo marketer but you have a very strong tool for ads benchmark and you save lot a time.",
      source: {
        href: "https://www.getapp.co.uk/software/2073744/panoramata",
        label: "Verified GetApp review, checked 2026-08-28",
        checked: "2026-08-28",
      },
    },
    furtherSources: [
      {
        href: "https://www.panoramata.co/track/website-changes",
        label: "Panoramata website-change tracking, checked 2026-08-08",
        checked: "2026-08-08",
      },
      {
        href: "https://www.panoramata.co/track/meta-ads",
        label: "Panoramata Meta ads tracking",
        checked: "2026-08-08",
      },
    ],
    transfers: [
      {
        title: "The competitor list",
        detail:
          "Domains, URLs, or brand names you already watch import as watchlists. Paste them or upload a CSV. That is the switch.",
      },
      {
        title: "Ads and landing pages from here on",
        detail:
          "Paid plans check public Meta ads and the live landing page on a schedule, and save page text, the source link, and a screenshot when the capture includes one.",
      },
    ],
    doesNotTransfer: [
      {
        title: "Screenshot archive and history",
        detail:
          "Panoramata's stored versions do not import. Five to Nine only has history for competitors you start watching here.",
      },
      {
        title: "Email, SMS, and flow captures",
        detail:
          "Those surfaces are Panoramata's. Five to Nine does not capture marketing emails, SMS, or flows.",
      },
      {
        title: "Side-by-side archive tools",
        detail:
          "Drag comparison, A/B-test detection, and Panoramata's longer stored history stay in Panoramata. We do not migrate them.",
      },
    ],
    relatedComparePath: "/compare/panoramata",
    extraSection: null,
    faqEntries: [
      {
        question: "Is Five to Nine a Panoramata alternative?",
        answer:
          "For the same public Meta ads and landing-page job from a pasted domain, yes. A verified GetApp reviewer says Panoramata's price feels a bit high for a solo marketer; Five to Nine does the same ads and pages job from a pasted domain.",
      },
      {
        question: "What transfers from Panoramata?",
        answer:
          "Domains, URLs, or brand names you already watch import as watchlists. Paste them or upload a CSV. Paid plans then check public Meta ads and the live landing page on a schedule, saving page text, the source link, and a screenshot when the capture includes one.",
      },
      {
        question: "What does not transfer from Panoramata?",
        answer:
          "Panoramata's screenshot archive and history, email, SMS, and flow captures, and side-by-side archive tools stay in Panoramata. Five to Nine only has history for competitors you start watching here.",
      },
    ],
  },
  visualping: {
    slug: "visualping",
    productName: "Visualping",
    pathname: "/switch/visualping",
    title: "Visualping alternative for ad libraries | Five to Nine",
    description:
      "Visualping's own blog says 83% of detected changes are not important. Paste a domain for the same ad and landing-page job. Try the free preview.",
    ctaBrand: "visualping.io",
    previewSearchDomain: FREE_PREVIEW_SEARCH_DOMAIN,
    kicker: "Switch from Visualping",
    headline: "Skip the Ad Library URL hunt and the condition prompt.",
    deck: "Visualping's own blog says the AI classifies 83% of detected changes as not important. Its Meta Ad Library playbook still asks you to find the library URL and write a condition prompt. Five to Nine takes a domain.",
    cardLine: "Skip the Ad Library URL hunt and the condition prompt. Five to Nine takes a domain and flags real moves.",
    complaint: {
      kicker: "The public complaint",
      heading: "Cited, not invented.",
      quote:
        "Across Visualping's platform, the AI classifies 83% of detected changes as not important.",
      source: {
        href: "https://visualping.io/blog/how-visualping-cuts-false-positives",
        label: "Visualping on false positives, checked 2026-08-08",
        checked: "2026-08-08",
      },
    },
    furtherSources: [
      {
        href: "https://visualping.io/blog/monitor-competitors-meta-ad-libraries",
        label: "Visualping Meta Ad Library playbook",
        checked: "2026-08-08",
      },
      {
        href: "https://softwarefinder.com/legal/visualping/reviews",
        label: "SoftwareFinder Visualping review, Dec 2025",
        checked: "2026-08-08",
      },
    ],
    transfers: [
      {
        title: "The domain, not the Ad Library URL",
        detail:
          "Paste the competitor website. You do not have to find the Meta Ad Library URL or write a condition prompt to start a watch.",
      },
      {
        title: "A preview with no account",
        detail:
          "The public search preview runs a real Meta Ad Library check and says when the result is live, cached, or unavailable.",
      },
    ],
    doesNotTransfer: [
      {
        title: "Saved Visualping monitors",
        detail:
          "Existing Visualping jobs, selected page regions, and hand-written AI conditions do not import. Recreate watches from the domain list.",
      },
      {
        title: "Pixel diffs and check history",
        detail:
          "Visualping's screenshot diffs and exhausted-check history stay in Visualping. We do not migrate them.",
      },
      {
        title: "Any-URL visual monitoring",
        detail:
          "Visualping watches any public URL. Five to Nine is built around competitor ads and landing pages, not generic website pixels.",
      },
    ],
    relatedComparePath: "/compare/visualping-ad-libraries",
    extraSection: {
      kicker: "No phantom changes",
      heading: "What we refuse to alert on.",
      items: NO_PHANTOM_CHANGE_RULES,
    },
    faqEntries: [
      {
        question: "Is Five to Nine a Visualping alternative for ad libraries?",
        answer:
          "For watching competitor ads and landing pages from a pasted domain, yes. Visualping's own blog says the AI classifies 83% of detected changes as not important, and its Meta Ad Library playbook still asks you to find the library URL and write a condition prompt. Five to Nine takes a domain.",
      },
      {
        question: "What transfers from Visualping?",
        answer:
          "Paste the competitor website instead of finding the Meta Ad Library URL or writing a condition prompt. The public search preview runs a real Meta Ad Library check with no account and says when the result is live, cached, or unavailable.",
      },
      {
        question: "What does not transfer from Visualping?",
        answer:
          "Existing Visualping jobs, selected page regions, hand-written AI conditions, screenshot diffs, and check history do not import. Visualping watches any public URL; Five to Nine is built around competitor ads and landing pages, not generic website pixels.",
      },
    ],
  },
  magicbrief: {
    slug: "magicbrief",
    productName: "MagicBrief",
    pathname: "/switch/magicbrief",
    title: "MagicBrief alternative after the shutdown | Five to Nine",
    description:
      "MagicBrief closed on 31 July 2026. Your competitor list imports here as watchlists; saved boards and report history do not. Try the free preview.",
    ctaBrand: "magicbrief.com",
    previewSearchDomain: FREE_PREVIEW_SEARCH_DOMAIN,
    kicker: "MagicBrief closed 31 July 2026",
    headline: "The library shut down. Your competitor list still works.",
    deck: "MagicBrief closed on 31 July 2026 after the Canva acquisition. Its successor, Canva Grow, runs on every Canva plan with the highest usage tiers inside Canva Business — listed at US$250 a year per person. If you tracked competitors in MagicBrief, paste the same list here and it becomes watchlists.",
    cardLine:
      "MagicBrief closed 31 July 2026. The same competitor list imports here as watchlists.",
    complaint: {
      kicker: "The public record",
      heading: "The shutdown, in their own words.",
      quote: "With Canva Grow now live, MagicBrief will close on July 31, 2026.",
      source: {
        href: "https://magicbrief.com/faqs",
        label: "MagicBrief shutdown FAQ, checked 2026-09-11",
        checked: "2026-09-11",
      },
    },
    furtherSources: [
      {
        href: "https://www.canva.com/pricing/",
        label: "Canva pricing — Business at US$250/year per person",
        checked: "2026-09-11",
      },
      {
        href: "https://magicbrief.com/post/magicbrief-canva-acquisition",
        label: "MagicBrief's Canva acquisition post, checked 2026-09-11",
        checked: "2026-09-11",
      },
    ],
    transfers: [
      {
        title: "The competitor list",
        detail:
          "The brands you tracked — domains, URLs, or brand names — import as watchlists. Paste them or upload a CSV. That is the switch.",
      },
      {
        title: "Ads and landing pages from here on",
        detail:
          "Paid plans check public Meta ads and the live landing page on a schedule, and save page text, the source link, and a screenshot when the capture includes one.",
      },
    ],
    doesNotTransfer: [
      {
        title: "Inspire collections and boards",
        detail:
          "MagicBrief's own FAQ says Inspire collections have no bulk export. Saved ad collections and boards do not import into Five to Nine.",
      },
      {
        title: "Insights reports and analytics history",
        detail:
          "MagicBrief let Insights reports export as CSV until shutdown. That history does not import — keep your exports as the record.",
      },
      {
        title: "Their historical archive",
        detail:
          "Five to Nine only has history for competitors you start watching here. Nothing older than your first scan exists.",
      },
    ],
    relatedComparePath: null,
    extraSection: {
      kicker: "The official successor",
      heading: "What Canva Grow actually is.",
      items: [
        {
          title: "A Canva product, not a port",
          detail:
            "MagicBrief's own FAQ says Canva Grow is built on the same DNA but is a net-new product, not a direct port. It currently supports Meta and TikTok.",
        },
        {
          title: "Tiered inside a bundle",
          detail:
            "Canva Grow is available on every Canva plan; the highest usage tiers sit inside Canva Business, listed at US$250 a year per person on Canva's pricing page.",
        },
        {
          title: "A different job than this page",
          detail:
            "Canva Grow is creative analytics and ad performance inside a design suite. Five to Nine is competitor monitoring: ads and landing pages, checked on a schedule, with source-linked proof.",
        },
      ],
    },
    faqEntries: [
      {
        question: "What happened to MagicBrief?",
        answer:
          "MagicBrief announced its wind-down and closed on 31 July 2026, after Canva acquired the team and built Canva Grow. Its own FAQ says the platform is no longer accessible.",
      },
      {
        question: "Is Five to Nine a MagicBrief alternative?",
        answer:
          "For watching competitor Meta ads and landing pages from a pasted domain, yes. For a saved-creative library and boards, no — Five to Nine's library is narrower and change-focused, and MagicBrief collections do not import.",
      },
      {
        question: "What transfers from MagicBrief?",
        answer:
          "The competitor list — domains, URLs, or brand names, pasted or as a CSV — imports as watchlists. Inspire collections, boards, Insights reports, and analytics history do not transfer.",
      },
    ],
  },
  // Issue #3091: the AdSpy switch page — the documented declining incumbent
  // (BET 8). Every complaint here cites a public source: the Trustpilot
  // rating and charge-after-cancel reports, the missing self-service cancel
  // path, and the absent public API (the last two visible on AdSpy's own
  // site and its Trustpilot record — nothing claimed beyond the citations).
  adspy: {
    slug: "adspy",
    productName: "AdSpy",
    pathname: "/switch/adspy",
    title: "AdSpy alternative | Five to Nine",
    description:
      "AdSpy carries a 2.4/5 Trustpilot rating, no self-service cancel, and no public API. Paste a domain for the same public Meta ads job. Try the free preview.",
    ctaBrand: "adspy.com",
    previewSearchDomain: FREE_PREVIEW_SEARCH_DOMAIN,
    kicker: "Switch from AdSpy",
    headline: "Same public Meta ads job. A plan you can leave.",
    deck: "AdSpy's Trustpilot rating is 2.4 out of 5, and reviewers report being charged after they tried to cancel — there is no self-service cancel path and no public API on its single $149-a-month plan. Five to Nine does the same public Meta ads and landing-page job from a pasted domain, and paid plans cancel self-serve in the billing portal.",
    cardLine:
      "AdSpy: 2.4/5 on Trustpilot, no self-serve cancel, no public API. The same public Meta ads job from a pasted domain.",
    complaint: {
      kicker: "The public record",
      heading: "Cited, not invented.",
      quote:
        "AdSpy's Trustpilot rating is 2.4 out of 5, and reviewers report being charged after they tried to cancel.",
      source: {
        href: "https://www.trustpilot.com/review/adspy.com",
        label: "AdSpy on Trustpilot, checked 2026-09-10",
        checked: "2026-09-10",
      },
    },
    furtherSources: [
      {
        href: "https://www.adspy.com/",
        label: "AdSpy home — one plan, no public API listed, checked 2026-09-10",
        checked: "2026-09-10",
      },
    ],
    transfers: [
      {
        title: "The competitor list",
        detail:
          "The brands you watched — domains, URLs, or brand names — import as watchlists. Paste them or upload a CSV. That is the switch.",
      },
      {
        title: "Ads and landing pages from here on",
        detail:
          "Paid plans check public Meta ads and the live landing page on a schedule, and save page text, the source link, and a screenshot when the capture includes one.",
      },
      {
        title: "A cancel path that exists",
        detail:
          "Paid plans cancel self-serve from the billing portal — no support email required to leave.",
      },
    ],
    doesNotTransfer: [
      {
        title: "AdSpy searches and saved ads",
        detail:
          "Your AdSpy search history and saved ad cards stay in AdSpy — there is no API to export them through. Five to Nine only has history for competitors you start watching here.",
      },
      {
        title: "The raw ad feed",
        detail:
          "Browsing a giant ad database by keyword and engagement is AdSpy's core job. Five to Nine is scheduled change detection on the competitors you name — not a raw feed of everything running.",
      },
      {
        title: "The walled-garden workflow",
        detail:
          "AdSpy lists no public API, so nothing pipes its data into your own tooling. Five to Nine ships API and MCP access on paid plans for exactly that job.",
      },
    ],
    relatedComparePath: "/compare/adspy",
    extraSection: {
      kicker: "Leaving AdSpy",
      heading: "What the public record says about leaving.",
      items: [
        {
          title: "No self-service cancel",
          detail:
            "AdSpy offers no self-service cancel path, and Trustpilot reviewers report charges landing after they tried to cancel. Keep your cancellation email thread — it is the record.",
        },
        {
          title: "No public API out",
          detail:
            "AdSpy lists no public API, so saved searches and collections cannot be pulled out programmatically. The part that moves is the competitor list itself — a paste or a CSV.",
        },
        {
          title: "The part that is yours",
          detail:
            "The list of competitors you watched was always yours. It imports here as watchlists in one paste.",
        },
      ],
    },
    faqEntries: [
      {
        question: "Is Five to Nine an AdSpy alternative?",
        answer:
          "For watching competitor Meta ads and landing pages from a pasted domain, yes. AdSpy carries a 2.4 out of 5 Trustpilot rating, no self-service cancel, and no public API. For browsing a raw database of millions of ads, no — Five to Nine is scheduled change detection on the brands you name, not an ad feed.",
      },
      {
        question: "What transfers from AdSpy?",
        answer:
          "The competitor list — domains, URLs, or brand names, pasted or as a CSV — imports as watchlists. AdSpy search history, saved ads, and database access do not transfer.",
      },
      {
        question: "Can I cancel Five to Nine myself?",
        answer:
          "Yes — paid plans cancel self-serve from the billing portal, no support email required. AdSpy reviewers report the opposite on Trustpilot: no self-service cancel path and charges after trying to leave.",
      },
    ],
  },
};

export const SWITCH_SLUGS = Object.keys(SWITCH_PAGES) as SwitchSlug[];

/**
 * Map a searched brand domain onto its /switch/* destination page (issue
 * 1554). Only the named switching triggers (Panoramata, Visualping, the
 * shut-down MagicBrief since issue #2887, and — since issue #3091 — the
 * declining incumbent AdSpy) resolve — never a
 * `<label>.com` guess from the query text alone. Same normalization as the
 * /ads/:domain resolver (trim + lowercase + strip `www.`) so a `?website=`
 * domain search and a V2-resolved brand both land here. Returns null for
 * every other domain.
 */
export function switchPageForDomain(domain: string): SwitchPage | null {
  const normalized = domain.trim().toLowerCase().replace(/^www\./, "");
  switch (normalized) {
    case "panoramata.co":
      return SWITCH_PAGES.panoramata;
    case "visualping.io":
      return SWITCH_PAGES.visualping;
    case "magicbrief.com":
      return SWITCH_PAGES.magicbrief;
    case "adspy.com":
      return SWITCH_PAGES.adspy;
    default:
      return null;
  }
}
