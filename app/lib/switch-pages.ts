import type { FaqJsonLdEntry } from "~/lib/seo";

export type SwitchSlug = "magicbrief" | "panoramata" | "visualping";

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
  kicker: string;
  headline: string;
  deck: string;
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
  magicbrief: {
    slug: "magicbrief",
    productName: "MagicBrief",
    pathname: "/switch/magicbrief",
    title: "MagicBrief alternative | Five to Nine",
    description:
      "MagicBrief closed 31 July 2026. Your competitor list can import as watchlists; collections and analytics do not transfer. Try the free preview.",
    ctaBrand: "magicbrief.com",
    kicker: "Switch from MagicBrief",
    headline: "MagicBrief closed. Here is what actually moves.",
    deck: "MagicBrief's own FAQ says the platform closed on 31 July 2026 at 8 PM EST. The successor is Canva Grow, sold inside Canva Business. Paste your competitor list here. Collections, boards, and analytics history stay behind.",
    complaint: {
      kicker: "The public record",
      heading: "The platform closed.",
      quote:
        "With Canva Grow now live, MagicBrief will close on July 31, 2026.",
      source: {
        href: "https://magicbrief.com/faqs",
        label: "MagicBrief FAQ, checked 2026-08-26",
        checked: "2026-08-26",
      },
    },
    furtherSources: [
      {
        href: "https://magicbrief.com/post/magicbrief-canva-acquisition",
        label: "MagicBrief's Canva acquisition post",
        checked: "2026-08-26",
      },
      {
        href: "https://www.businesswire.com/news/home/20260625870253/en/",
        label: "Canva Grow 2.0 announcement",
        checked: "2026-08-08",
      },
    ],
    transfers: [
      {
        title: "Your tracked brands",
        detail:
          "A plain list of domains, URLs, or brand names, pasted or as a CSV, imports as watchlists with notes, tags, and client labels. That is what transfers.",
      },
      {
        title: "A preview before anything is written",
        detail:
          "You see the rows first. Duplicates and invalid rows are flagged, never silently dropped. Keep your original export as the record of what the import carried.",
      },
    ],
    doesNotTransfer: [
      {
        title: "Collections and boards",
        detail:
          "Saved ad libraries, boards, and saved creative evidence do not transfer. Five to Nine does not migrate them.",
      },
      {
        title: "Analytics and report history",
        detail:
          "Spend, impressions, reach, charts, and report dates are not imported. MagicBrief's FAQ says Insights can export as CSV until shutdown; Inspire collections have no bulk export.",
      },
      {
        title: "Past screenshots",
        detail:
          "Historical evidence from MagicBrief does not carry over. New watches save page text and the source link going forward, plus a screenshot when the capture includes one.",
      },
    ],
    relatedComparePath: "/compare/magicbrief",
    extraSection: null,
    faqEntries: [
      {
        question: "Is Five to Nine a MagicBrief alternative?",
        answer:
          "For competitor-list migration and change monitoring, yes. MagicBrief's own FAQ says the platform closed on 31 July 2026 at 8 PM EST; the successor is Canva Grow, sold inside Canva Business. Five to Nine watches your competitors and saves page text, the source link, and a screenshot when the capture includes one.",
      },
      {
        question: "What transfers from MagicBrief?",
        answer:
          "Your tracked brands, pasted or as a CSV, import as watchlists with notes, tags, and client labels. You see the rows first — duplicates and invalid rows are flagged, never silently dropped. That is what transfers.",
      },
      {
        question: "What does not transfer from MagicBrief?",
        answer:
          "Saved ad libraries, boards, analytics and report history, and past screenshots stay behind. Five to Nine does not migrate them — keep your original export as the record of what the import carried.",
      },
    ],
  },
  panoramata: {
    slug: "panoramata",
    productName: "Panoramata",
    pathname: "/switch/panoramata",
    title: "Panoramata alternative | Five to Nine",
    description:
      "A verified reviewer says Panoramata's price feels high for a solo marketer. Paste a domain for the same ads and pages job. Try the free preview.",
    ctaBrand: "panoramata.co",
    kicker: "Switch from Panoramata",
    headline: "Same ads and pages job. Paste a domain.",
    deck: "A verified GetApp reviewer says Panoramata's price feels a bit high for a solo marketer. Five to Nine does the same public Meta ads and landing-page job from a pasted domain.",
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
    kicker: "Switch from Visualping",
    headline: "Skip the Ad Library URL hunt and the condition prompt.",
    deck: "Visualping's own blog says the AI classifies 83% of detected changes as not important. Its Meta Ad Library playbook still asks you to find the library URL and write a condition prompt. Five to Nine takes a domain.",
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
    relatedComparePath: "/compare/visualping",
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
};

export const SWITCH_SLUGS = Object.keys(SWITCH_PAGES) as SwitchSlug[];
