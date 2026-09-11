import {
  createLpRunAuditContext,
  runLpRunAuditStage,
  type LpRunAuditContext,
} from "~/lib/landing-page-run-audit.server";
import { decodeHtmlEntities } from "~/lib/decode-html.server";
import { hashString, stripChurnTokens } from "~/lib/normalize";

export const LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION = "lp-signals-v8";

export type ExtractorSuppressionReason = "churn_stable" | "ad_slot_strip";

// CTA field-extraction funnel (issue #1401). The CTA detector was silent for
// 75 days because a bail-out left ctaText null with no recorded reason, so the
// question "did the check reach CTA extraction vs. bail out, and why?" was not
// answerable. The funnel makes the bail-out diagnosable:
//   - "reached": the extractor produced a non-null CTA value.
//   - "bailed":  the extractor produced null, with a reasonCode naming the gate.
// "unchanged" is a diff-time concept (both captures reached, values matched),
// not an extraction concept, so it is classified downstream — see
// recordDiffStage in landing-page-pipeline-instrumentation.server.ts.
export type CtaFunnelStage = "reached" | "bailed";

// Reason codes name the exact gate that dropped the CTA. They are stable
// strings so a backfill / log query can GROUP BY them and surface the dominant
// bail-out (issue #1401 accept 4).
//   - no_cta_candidates: no <button>, no submit input, and no <a> at all.
//   - only_chrome_buttons: buttons existed but every one was UI chrome
//     (CTA_CHROME_BUTTON_TEXTS), no priority verb matched, and no usable
//     anchor fallback.
//   - only_chrome_anchors: action links existed but every one was navigation
//     chrome (CTA_CHROME_ANCHOR_TEXTS), no priority verb matched, and no
//     usable button fallback.
//   - empty_capture: the HTML fed to extraction had no visible text content
//     (a shell / challenge body that slipped past the capture-validity gate).
export type CtaFunnelReasonCode =
  | "no_cta_candidates"
  | "only_chrome_buttons"
  | "only_chrome_anchors"
  | "empty_capture";

export interface CtaFunnel {
  stage: CtaFunnelStage;
  reasonCode: CtaFunnelReasonCode | null;
}

export interface ExtractorSuppressionFingerprints {
  rawTextHash: string;
  adSlotStrippedTextHash: string;
  churnStableTextHash: string;
}

const CTA_PRIORITY_PATTERNS = [
  /\b(buy now|shop now|add to cart|get offer|claim deal|book demo|whatsapp us|get started)\b/i,
  /\b(order now|start now|apply now|join now|download app|talk to us)\b/i,
  // v5: the priority list was the single biggest bail-out in the detector
  // (issue #949). Real commercial CTAs like "Sign up free", "Try it now",
  // "Contact sales", "Get a quote", "Subscribe", "Start free trial" all
  // returned null and made the CTA diff blind to them — a page whose CTA
  // never matched could never fire a CTA change, even when it genuinely
  // changed. These verbs are unambiguously commercial actions.
  /\b(sign up|sign up free|try free|try now|try it now|try it free|start free trial|start trial|free trial)\b/i,
  /\b(contact us|contact sales|talk to sales|get a quote|get quote|request a quote|request quote)\b/i,
  /\b(subscribe|register|create account|create free account|create your account)\b/i,
  /\b(explore plans|view plans|see plans|see pricing|view pricing|see plans & pricing)\b/i,
  /\b(schedule a demo|request a demo|book a demo|demo request)\b/i,
  /\bsubmit\b/i,
] as const;

// v5 button-text fallback: when no candidate matches a priority pattern, the
// detector previously returned null — making the CTA diff permanently blind
// to that page. A `<button>` element is an action control by definition, so
// its text is a real CTA even when the verb is not in the priority list (e.g.
// "Build my report", "Send my brief"). The fallback picks the first
// non-trivial button text that is not obvious UI chrome.
//
// The blocklist is deliberately tiny and conservative: only buttons that are
// unambiguously navigation/chrome (menu, close, search, settings, etc.).
// Commercial verbs are never blocked here — they either match a priority
// pattern above or flow through the fallback as a real CTA.
const CTA_CHROME_BUTTON_TEXTS = new Set([
  "menu",
  "close",
  "open",
  "toggle",
  "expand",
  "collapse",
  "next",
  "previous",
  "prev",
  "back",
  "forward",
  "search",
  "filter",
  "sort",
  "settings",
  "account",
  "ok",
  "okay",
  "cancel",
  "delete",
  "remove",
  "edit",
  "save",
  "yes",
  "no",
  // v6 chrome hardening (issue #1401 live backfill): Calendly/cookie/
  // accordion chrome was winning the button fallback and making the CTA
  // diff watch a non-CTA label ("Show more", day-of-month digits, cookie
  // consent). Same for search-command buttons ("Search… Ctrl K").
  "show more",
  "show less",
  "load more",
  "see more",
  "read less",
  "cookie settings",
  "cookie details",
  "accept all",
  "allow all",
  "reject all",
  "decline all",
  "confirm my choices",
  "apply",
  "clear",
  "back button",
  "filter icon",
  "try again",
  "forgotten password?",
  "forgot password?",
  "forgot password",
  "forgotten password",
  "reset password",
]);

// v6 anchor-text fallback (issue #1401): #949's button fallback closed the
// "no priority verb + no <button>" bail for button-bearing pages, but pages
// whose only CTA is a generic anchor (`<a href="/learn">Learn more</a>`) still
// bailed — the probe in tests/cta-anchor-probe.test.ts returns null for them,
// and that is the remaining dominant CTA bail-out. A blind anchor fallback is
// wrong (the #949 comment deliberately excluded links: "links are often
// navigation"), so this is a SELECTIVE fallback: the first action link whose
// text is not navigation chrome. Soft CTAs ("Learn more", "Read more",
// "Find out more", "Discover", "Explore") are NOT chrome — they are real
// (if soft) calls to action and flow through. Pure navigation/structural
// links (About, Home, Login, Blog, Docs, Careers, Terms, …) are blocked so
// the diff never watches a nav label that rotates on every render.
//
// The anchor fallback runs ONLY when no priority verb matched AND no usable
// button was found — it is the third tier, after the priority list and the
// button fallback. A page with a real <button> never reaches it.
const CTA_CHROME_ANCHOR_TEXTS = new Set([
  "about",
  "about us",
  "home",
  "blog",
  "news",
  "press",
  "events",
  "webinars",
  "webinar",
  "podcast",
  "podcasts",
  "services",
  "products",
  "product",
  "features",
  "solutions",
  "platform",
  "integrations",
  "api",
  "faq",
  "faqs",
  "help",
  "help center",
  "support",
  "docs",
  "documentation",
  "resources",
  "library",
  "guides",
  "tutorials",
  "careers",
  "jobs",
  "team",
  "company",
  "our team",
  "our company",
  "partners",
  "partner with us",
  "investors",
  "investor relations",
  "contact", // bare "contact"; "contact us"/"contact sales" are priority CTAs
  "login",
  "log in",
  "sign in",
  "signin",
  "log out",
  "logout",
  "sign up", // priority verb — never reaches fallback, listed for safety
  "register", // priority verb — listed for safety
  "terms",
  "terms of service",
  "privacy",
  "privacy policy",
  "legal",
  "security",
  "status",
  "sitemap",
  "menu",
  "close",
  "back",
  "next",
  "previous",
  "prev",
  "skip",
  "skip to content",
  "skip to main content",
  "more",
  "read the docs",
  "view docs",
  "github",
  "twitter",
  "linkedin",
  "youtube",
  "facebook",
  "instagram",
  // v6 chrome hardening (issue #1401 live backfill): widget/footer chrome
  // that is not a commercial CTA.
  "powered by calendly",
  "privacy notice",
  "cookie policy",
  "cookie preferences",
  "try again",
  "forgotten password?",
  "forgot password?",
  "forgot password",
  "forgotten password",
  "reset password",
  "cookie details",
  "cookie settings",
  "accept all",
  "allow all",
  "reject all",
  "decline all",
]);

const PRICE_PATTERNS = [
  /\b(starting at\s+(?:₹|rs\.?\s*)\s*\d[\d,]*)\b/i,
  /\b((?:₹|rs\.?\s*)\s*\d[\d,]*)\b/i,
  /((?:[$€£]\s*)\d[\d,]*(?:\.\d{1,2})?)/i,
  /\b((?:usd|eur|gbp)\s+\d[\d,]*(?:\.\d{1,2})?)\b/i,
  /\b((?:up to\s+)?\d+%\s*off)\b/i,
  /\b(buy\s*\d+\s*get\s*\d+)\b/i,
] as const;

// Declared-currency anchoring (issue #2861, lp-signals-v7). A localized
// render can carry a currency-marked string that is NOT the page's offer
// currency — allbirds.com showed a UK-geo announcement bar ("Free shipping
// and returns on orders over £50") ahead of its USD product prices, and
// first-in-text matching flipped the stored price £50/$100 between renders
// of a page whose shop currency never changed. The page's own declared
// currency (Shopify/Shop Pay `currencyCode`, JSON-LD `priceCurrency`,
// `og:price:currency` meta, `data-currency` attributes) is deterministic
// per page version, so when it resolves we prefer the first candidate whose
// marker is consistent with it. When no declaration resolves — or no
// candidate matches it — the historical first-match behaviour applies
// unchanged, so the anchor can only disambiguate, never blank a price.
//
// Codes are matched against an allowlist so arbitrary 3-letter tokens in a
// `currency`-named field (e.g. "all", "yes") can never win a preference.
const KNOWN_CURRENCY_CODES = new Set([
  "USD", "EUR", "GBP", "INR", "JPY", "CNY", "AUD", "CAD", "CHF", "SEK",
  "NOK", "DKK", "RUB", "KRW", "BRL", "MXN", "ZAR", "AED", "HKD", "SGD",
  "NZD", "TWD", "THB", "MYR", "IDR", "PHP", "VND", "PLN", "CZK", "HUF",
  "RON", "TRY", "ILS", "SAR", "NGN", "KES", "EGP", "PKR", "BDT", "LKR",
  "NPR", "ARS", "CLP", "COP", "PEN", "UYU", "QAR", "KWD",
]);

const DECLARED_CURRENCY_PATTERNS = [
  // Shopify / Shop Pay / JSON-LD blobs, quoted or bare keys:
  //   "currencyCode":"USD", currencyCode:"USD", "priceCurrency":"USD",
  //   "currency":"USD", currency:"USD"
  /\b(?:currencyCode|priceCurrency|currency)["']?\s*:\s*["']([A-Za-z]{3})["']/gi,
  // JS assignments: currency = 'USD', shopCurrency="USD"
  /\bcurrency\s*=\s*["']([A-Za-z]{3})["']/gi,
  // Shopify money object: currency = {"active":"USD", ...}
  /\bcurrency\s*=\s*\{[^}]{0,200}?\bactive["']?\s*:\s*["']([A-Za-z]{3})["']/gi,
  // Open Graph / product meta, either attribute order:
  //   <meta property="og:price:currency" content="USD">
  /\bproperty\s*=\s*["'](?:og:price:currency|product:price:currency)["'][^>]{0,200}?\bcontent\s*=\s*["']([A-Za-z]{3})["']/gi,
  /\bcontent\s*=\s*["']([A-Za-z]{3})["'][^>]{0,200}?\bproperty\s*=\s*["'](?:og:price:currency|product:price:currency)["']/gi,
] as const;

// Declared-market anchoring for the capture-validity gate (issue #2889,
// lp-signals-v8). A geo-experiment render can swap the CTA entirely —
// allbirds.com alternated "Shop Now" (GB render) and "Sign Up" (US render)
// between captures of the SAME canonical URL, with an identical locale
// (en-US) and identical declared currency (USD). The only deterministic
// difference is the page's own declared market: `Shopify.country = "GB"`
// vs `"US"`, `"countryCode":"GB"` vs `"US"`, distinct market ids. That
// declaration is stored on the snapshot metadata so the capture-validity
// gate can suppress a same-URL render-variant pair instead of reporting a
// phantom CTA transition.
const DECLARED_MARKET_PATTERNS = [
  // Shopify storefront scripts: Shopify.country = "GB";
  /\bShopify\.country\s*=\s*["']([A-Za-z]{2})["']/gi,
  // Shopify/Shop Pay JSON blobs: "countryCode":"US", countryCode:'US'
  /\bcountryCode["']?\s*:\s*["']([A-Za-z]{2})["']/gi,
  // Generic JSON market blocks: "country":"US"
  /\b"country"\s*:\s*["']([A-Za-z]{2})["']/gi,
] as const;

// ISO-3166-1 alpha-2 allowlist. A 2-letter token inside a country-named
// field can only stand for a market when it is a real country code, so
// values like "us"-the-word or locale-shaped strings never win.
const KNOWN_COUNTRY_CODES = new Set(
  ("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI " +
    "BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN " +
    "CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK " +
    "FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM " +
    "HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN " +
    "KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK " +
    "ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP " +
    "NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
    "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF " +
    "TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI " +
    "VN VU WF WS YE YT ZA ZM ZW").split(" "),
);

// Which ISO codes a bare symbol can stand for. "£"/"€"/"₹" are unambiguous;
// "$" is shared by every dollar currency so a USD-declared page and an
// AUD-declared page both keep their "$" candidates; "¥" is JPY or CNY.
const CURRENCY_MARKER_CODES: Record<string, ReadonlySet<string>> = {
  $: new Set([
    "USD", "AUD", "CAD", "SGD", "NZD", "HKD", "MXN", "BRL", "ARS", "CLP",
    "COP", "TWD",
  ]),
  "£": new Set(["GBP"]),
  "€": new Set(["EUR"]),
  "₹": new Set(["INR"]),
  "¥": new Set(["JPY", "CNY"]),
  "₽": new Set(["RUB"]),
  "₩": new Set(["KRW"]),
};
const LEAD_FIELD_PATTERN = /\b(name|email|phone|mobile|tel|whatsapp)\b/i;
const MAX_HTML_TAG_SCAN_LENGTH = 4_096;
const HIDDEN_RECOVERY_TAG_NAMES = new Set(["script", "style", "template"]);
const HEAD_ELEMENT_NAMES = new Set([
  "base",
  "basefont",
  "bgsound",
  "head",
  "link",
  "meta",
  "noframes",
  "noscript",
  "script",
  "style",
  "template",
  "title",
]);
const HEAD_CONTENT_CONTAINER_NAMES = new Set([
  "noframes",
  "noscript",
  "script",
  "style",
  "template",
  "title",
]);
const SHELL_PLACEHOLDER_PATTERN =
  /^(?:loading(?:\s+(?:app|application))?(?:,\s*please wait)?|please wait|initializing)(?:[.!…]+)?$/i;

// Ad-slot suppression (since lp-signals-v4): rotating third-party ad creatives are
// the loudest remaining landing-page noise source. A banner that swaps
// between "Buy now · $19.99" and "Claim deal · $9.99" must never become
// customer-visible offer/CTA/form events, so ad containers are stripped from
// signal extraction the same way script/style content already is.
//
// Two recognition paths run together:
//   1. id/class token match against AD_SLOT_MARKER_TOKENS — covers the common
//      "ad", "adsbygoogle", "taboola", "dfp" ids and the vendor class names
//   2. AD_SLOT_DATA_ATTRIBUTE_NAMES — Google Ad Manager signatures that
//      appear with no id/class at all (a `<div data-ad-slot="1234567">`
//      houses exactly the same rotating creatives as a labelled banner)
//
// Both paths are deliberately tolerant: a false negative leaks ad copy into
// the diff (a churn event), a false positive strips real product copy (a
// missed event). The cost balance favours noise suppression — the existing
// fail-safe bound keeps anything we cannot confidently close intact.
const AD_SLOT_MARKER_TOKENS = new Set([
  "ad",
  "ads",
  "adslot",
  "adunit",
  "adbox",
  "advert",
  "adverts",
  "advertisement",
  "advertising",
  "advertisment",
  "adcontainer",
  "adwrapper",
  "adsbygoogle",
  "adsense",
  "googleads",
  "googletag",
  "doubleclick",
  "dfp",
  "sponsored",
  "sponsor",
  "sponsors",
  "sponsorship",
  "taboola",
  "outbrain",
  "criteo",
  "prebid",
  "amazonads",
  "adchoices",
  "promoads",
  "nativeads",
  "leaderboard",
  "skyscraper",
  "inread",
  "infeed",
  "popunder",
  "interstitial",
  "affiliate",
]);
// Google Ad Manager attributes: every one of these is the GAM signature on a
// rotating ad slot. The values are slot IDs / client codes / format hints, not
// human copy — we never read them, only check for the attribute name.
const AD_SLOT_DATA_ATTRIBUTE_NAMES = new Set([
  "data-ad-slot",
  "data-ad-unit",
  "data-ad-client",
  "data-ad-format",
  "data-ad-layout",
  "data-ad-layout-key",
  "data-ad-test",
]);
// Elements that are structurally ad frames: no page-owned copy lives inside
// them, and cross-origin ad iframes rotate content beyond our visibility.
const AD_SLOT_BARE_TAG_NAMES = new Set(["iframe", "fencedframe", "amp-ad"]);
// Containers whose text can look like markup. Treated as opaque by the ad
// pre-pass so JS strings like "<div class=ad>" can never mask real content.
const AD_SLOT_OPAQUE_TAG_NAMES = new Set(["script", "style", "template"]);
// A bounded ad region that never closes is treated as NOT an ad region:
// stripping to a malformed end could eat real offer/copy content after it.
const AD_SLOT_REGION_SCAN_LIMIT = 24 * 1024;

export function extractLandingPageSignals(
  html: string,
  options: {
    documentMode?: "raw" | "rendered";
    /**
     * Issue #1500: when present, the extractor emits one
     * `tag: "lp_run_audit"` JSON line per stage transition
     * (html_parse, anchor_resolve, cta_extract, price_extract,
     * form_extract). Stages owned by the capture path
     * (html_fetch, headline_extract, url_extract) are emitted by
     * the caller. When null/undefined the extractor is silent —
     * existing call sites do not change behaviour.
     */
    audit?: LpRunAuditContext | null;
  } = {},
) {
  const documentMode = options.documentMode ?? "raw";
  const audit =
    options.audit === undefined
      ? null
      : options.audit === null
        ? null
        : createLpRunAuditContext(options.audit);
  const rawHtml = html ?? "";
  // html_parse stage — removeNonVisibleElements + ad-slot strip.
  // A page that strips to nothing is an extraction bail-out (the
  // page rendered, but nothing survived the parser), distinct from
  // the "page never fetched" bail-out emitted at the html_fetch stage.
  const normalizedHtml = audit
    ? runLpRunAuditStage({
        context: audit,
        stage: "html_parse",
        bytesIn: utf8ByteLength(rawHtml),
        bailReasonFor: (parsed) =>
          parsed.length === 0 ? "empty_after_strip" : null,
        bytesOutFor: (parsed) => utf8ByteLength(parsed),
        fn: () => removeNonVisibleElements(rawHtml, documentMode),
      })
    : removeNonVisibleElements(rawHtml, documentMode);
  // Issue #949: button candidates are extracted separately so the v5
  // button-text fallback in pickBestCta can use them. They are cleaned
  // exactly once here — spreading them into ctaCandidates and cleaning
  // again would double-decode HTML entities (e.g. "&amp;hellip;" →
  // "&hellip;" → "…"), corrupting literal entity text.
  const buttonCandidates = extractButtonText(normalizedHtml).map(cleanText);
  // Issue #1401: anchor candidates are extracted separately so the v6
  // anchor-text fallback can filter navigation chrome without re-decoding.
  // anchor_resolve stage — extractActionLinks + cleanText. The stage
  // bails when the page has zero anchors at all (no_action_links) and
  // when every anchor is nav chrome (only_chrome_anchors); both feed
  // the v6 anchor fallback so the operator can tell apart "no link to
  // extract" from "every link was nav chrome".
  const anchorCandidates = audit
    ? runLpRunAuditStage({
        context: audit,
        stage: "anchor_resolve",
        bytesIn: utf8ByteLength(normalizedHtml),
        bailReasonFor: (anchors) => {
          if (anchors.length === 0) return "no_anchors";
          if (
            anchors.every((candidate) => CTA_CHROME_ANCHOR_TEXTS.has(candidate.toLowerCase().trim()))
          ) {
            return "anchor_chrome_only";
          }
          return null;
        },
        bytesOutFor: (anchors) =>
          anchors.reduce((total, anchor) => total + utf8ByteLength(anchor), 0),
        fn: () => extractActionLinks(normalizedHtml).map(cleanText),
      })
    : extractActionLinks(normalizedHtml).map(cleanText);
  const ctaCandidates = [
    ...buttonCandidates,
    ...extractSubmitValues(normalizedHtml).map(cleanText),
    ...anchorCandidates,
  ];

  // cta_extract stage — pickBestCta. The bail reason comes from the
  // funnel itself (no_cta_candidates / only_chrome_buttons /
  // only_chrome_anchors / empty_capture), which is exactly the
  // resolution the diff needs to see why a CTA event is missing.
  const { ctaText, funnel: ctaFunnel } = audit
    ? runLpRunAuditStage({
        context: audit,
        stage: "cta_extract",
        bytesIn: ctaCandidates.reduce(
          (total, candidate) => total + utf8ByteLength(candidate),
          0,
        ),
        bailReasonFor: ({ funnel }) =>
          funnel.stage === "bailed" ? (funnel.reasonCode ?? "unknown") : null,
        bytesOutFor: ({ ctaText: text }) => utf8ByteLength(text ?? ""),
        fn: () =>
          pickBestCta(ctaCandidates, buttonCandidates, anchorCandidates),
      })
    : pickBestCta(ctaCandidates, buttonCandidates, anchorCandidates);
  // price_extract stage — pickPrice over the normalized HTML. The
  // stage bails when no PRICE_PATTERN matched; the operator can then
  // see "this page never had a price" instead of guessing whether the
  // price was rotated out by the parser.
  // Issue #2861: the page's own declared currency is read from the RAW
  // html (the declarations live in script/head markup the normalizer
  // strips) and anchors candidate selection, so a localized string in a
  // different currency cannot outrank the shop's real price.
  const declaredCurrency = pickDeclaredCurrency(rawHtml);
  const priceText = audit
    ? runLpRunAuditStage({
        context: audit,
        stage: "price_extract",
        bytesIn: utf8ByteLength(normalizedHtml),
        bailReasonFor: (price) => (price === null ? "no_price_pattern" : null),
        bytesOutFor: (price) => utf8ByteLength(price ?? ""),
        fn: () => pickPrice(normalizedHtml, declaredCurrency),
      })
    : pickPrice(normalizedHtml, declaredCurrency);
  // form_extract stage — detectFormPresence. The stage bails when
  // the page has neither a lead input (email/phone/etc.) nor a submit
  // action — two distinct gates that both feed "no form" so the
  // operator can tell "no form at all" from "form present, no lead".
  const formPresent = audit
    ? runLpRunAuditStage({
        context: audit,
        stage: "form_extract",
        bytesIn: utf8ByteLength(normalizedHtml),
        bailReasonFor: (present) => (present ? null : "no_lead_input"),
        bytesOutFor: () => 0,
        fn: () => detectFormPresence(normalizedHtml),
      })
    : detectFormPresence(normalizedHtml);

  // An empty visible body (shell / challenge that slipped past the capture
  // gate) means extraction had nothing to work on — record it as the bail
  // reason instead of the structural no-candidates code so an operator can
  // tell "the page was blank" from "the page had only nav links".
  const resolvedFunnel: CtaFunnel =
    ctaFunnel.stage === "bailed" &&
    ctaFunnel.reasonCode === "no_cta_candidates" &&
    !hasVisibleBodyText(normalizedHtml)
      ? { stage: "bailed", reasonCode: "empty_capture" }
      : ctaFunnel;

  return {
    ctaText,
    ctaFunnel: resolvedFunnel,
    priceText,
    formPresent,
    extractorVersion: LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
    declaredMarketCountry: pickDeclaredMarketCountry(rawHtml),
    suppressionFingerprints: computeExtractorSuppressionFingerprints(
      html ?? "",
      documentMode,
    ),
  };
}

/**
 * Resolve the market a page declares for itself (issue #2889, lp-signals-v8):
 * Shopify's `Shopify.country` storefront assignment, `"countryCode"` JSON
 * fields, and generic `"country"` JSON fields. Read from the RAW html — the
 * declarations live in script/head markup the normalizer strips. Majority
 * vote across every declaration found, earliest occurrence winning ties —
 * deterministic for a given page version. Returns null when nothing
 * plausible is declared, so the capture-validity gate can only suppress a
 * KNOWN render-variant pair, never a capture whose market is unknown.
 */
export function pickDeclaredMarketCountry(html: string): string | null {
  const tally = new Map<string, { count: number; firstIndex: number }>();
  for (const pattern of DECLARED_MARKET_PATTERNS) {
    const global = new RegExp(
      pattern.source,
      pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
    );
    let match: RegExpExecArray | null;
    while ((match = global.exec(html)) !== null) {
      const code = match[1]?.toUpperCase();
      if (code && KNOWN_COUNTRY_CODES.has(code)) {
        const entry = tally.get(code) ?? { count: 0, firstIndex: match.index };
        entry.count += 1;
        entry.firstIndex = Math.min(entry.firstIndex, match.index);
        tally.set(code, entry);
      }
      if (match[0].length === 0) {
        global.lastIndex += 1;
      }
    }
  }
  let best: string | null = null;
  let bestCount = 0;
  let bestIndex = Number.POSITIVE_INFINITY;
  for (const [code, entry] of tally) {
    if (
      entry.count > bestCount ||
      (entry.count === bestCount && entry.firstIndex < bestIndex)
    ) {
      best = code;
      bestCount = entry.count;
      bestIndex = entry.firstIndex;
    }
  }
  return best;
}

function hasVisibleBodyText(html: string) {
  return cleanText(stripTags(html)).length > 0;
}

export function extractorSuppressionMetadata(
  fingerprints: ExtractorSuppressionFingerprints,
) {
  return {
    extractorRawTextHash: fingerprints.rawTextHash,
    extractorAdSlotStrippedTextHash: fingerprints.adSlotStrippedTextHash,
    extractorChurnStableTextHash: fingerprints.churnStableTextHash,
  };
}

/**
 * Layered HTML hashes so a later scan can tell "the markup moved" from
 * "a real offer/CTA/headline moved". Visible text is not enough: the BET 4
 * timestamp fixture lives in a meta attribute, and rotating banner creatives
 * live in href/src attributes. Layer A keeps ad slots. Layer B strips them.
 * Layer C is B after churn-token and ISO-timestamp stripping. Same C +
 * different B is timestamp churn. Same B + different A is a rotating banner.
 *
 * ISO timestamps are stripped here only. They are not added to the shared
 * headline churn list, because that list is baked into stored hashes.
 */
export function computeExtractorSuppressionFingerprints(
  html: string,
  documentMode: "raw" | "rendered" = "raw",
): ExtractorSuppressionFingerprints {
  const rawHtml = htmlForFingerprint(html, documentMode, false);
  const adSlotStrippedHtml = htmlForFingerprint(html, documentMode, true);
  const churnStableHtml = stripFingerprintChurn(adSlotStrippedHtml);
  return {
    rawTextHash: hashString(rawHtml),
    adSlotStrippedTextHash: hashString(adSlotStrippedHtml),
    churnStableTextHash: hashString(churnStableHtml),
  };
}

export function classifyExtractorSuppression(
  previous: ExtractorSuppressionFingerprints | null | undefined,
  current: ExtractorSuppressionFingerprints | null | undefined,
): ExtractorSuppressionReason | null {
  if (
    !previous?.rawTextHash ||
    !previous.adSlotStrippedTextHash ||
    !previous.churnStableTextHash ||
    !current?.rawTextHash ||
    !current.adSlotStrippedTextHash ||
    !current.churnStableTextHash
  ) {
    return null;
  }
  if (current.churnStableTextHash !== previous.churnStableTextHash) {
    return null;
  }
  if (current.adSlotStrippedTextHash !== previous.adSlotStrippedTextHash) {
    return "churn_stable";
  }
  if (current.rawTextHash !== previous.rawTextHash) {
    return "ad_slot_strip";
  }
  return null;
}

function htmlForFingerprint(
  html: string,
  documentMode: "raw" | "rendered",
  stripAdSlots: boolean,
) {
  return removeNonVisibleElements(html, documentMode, false, false, stripAdSlots);
}

// Fingerprint-only. Do not fold this into stripChurnTokens: that helper
// feeds stored normalizedHeadlineHash values, and adding a pattern there
// would fire a one-time headline-change alert on every watched page.
const FINGERPRINT_ISO_TIMESTAMP =
  /\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(?:\.\d+)?z?/gi;

function stripFingerprintChurn(html: string) {
  return stripChurnTokens(
    html.toLowerCase().replace(FINGERPRINT_ISO_TIMESTAMP, " "),
  );
}

export function hasMeaningfulLandingPageBodyText(
  html: string,
  options: { documentMode?: "raw" | "rendered" } = {},
) {
  const bodyHtml = removeNonVisibleElements(
    html ?? "",
    options.documentMode ?? "raw",
    true,
    true,
  );
  const bodyText = cleanText(stripTags(bodyHtml));
  return bodyText.length > 0 && !SHELL_PLACEHOLDER_PATTERN.test(bodyText);
}

function removeNonVisibleElements(
  html: string,
  documentMode: "raw" | "rendered",
  removeDocumentMetadata = false,
  ignoreNoscript = false,
  stripAdSlots = true,
) {
  const adSlotStripped = stripAdSlots
    ? stripAdSlotRegions(html ?? "")
    : (html ?? "");
  const elementNames = new Set(
    documentMode === "rendered"
      ? ["script", "style", "noscript", "template"]
      : ["script", "style", "template"],
  );
  if (removeDocumentMetadata) {
    elementNames.add("head");
    elementNames.add("title");
  }
  if (ignoreNoscript) {
    elementNames.add("noscript");
  }
  const output: string[] = [];
  let copyFrom = 0;
  let cursor = 0;
  let hiddenElement: string | null = null;
  let hiddenDepth = 0;
  const headContentElements: string[] = [];

  while (cursor < adSlotStripped.length) {
    const tagStart = adSlotStripped.indexOf("<", cursor);
    if (tagStart < 0) break;
    if (
      (!hiddenElement ||
        (hiddenElement === "head" && headContentElements.length === 0)) &&
      adSlotStripped.startsWith("<!--", tagStart)
    ) {
      const commentEnd = adSlotStripped.indexOf("-->", tagStart + 4);
      if (!hiddenElement) {
        output.push(adSlotStripped.slice(copyFrom, tagStart), " ");
        copyFrom = commentEnd < 0 ? adSlotStripped.length : commentEnd + 3;
      }
      cursor = commentEnd < 0 ? adSlotStripped.length : commentEnd + 3;
      if (commentEnd < 0) break;
      continue;
    }
    const prefix = readHtmlTagPrefix(adSlotStripped, tagStart);
    const hiddenOpeningTag = Boolean(
      prefix &&
      !prefix.closing &&
      elementNames.has(prefix.name),
    );
    const parsedTag = readHtmlTag(
      adSlotStripped,
      tagStart,
      hiddenOpeningTag ? adSlotStripped.length - tagStart : undefined,
      !hiddenOpeningTag,
      hiddenElement,
    );
    const tag = parsedTag.tag;
    if (!tag) {
      if (hiddenOpeningTag) {
        if (!hiddenElement) {
          output.push(adSlotStripped.slice(copyFrom, tagStart), " ");
        }
        copyFrom = adSlotStripped.length;
        break;
      }
      cursor = parsedTag.nextCursor;
      continue;
    }

    if (!hiddenElement) {
      if (!tag.closing && elementNames.has(tag.name)) {
        output.push(adSlotStripped.slice(copyFrom, tagStart), " ");
        copyFrom = tag.end;
        // HTML ignores XHTML-style slashes on these non-void elements. An
        // empty <head/> is the exception here because browsers implicitly
        // close it at body flow even without a literal </head>.
        if (!tag.selfClosing || tag.name !== "head") {
          hiddenElement = tag.name;
          hiddenDepth = 1;
        }
      }
    } else if (hiddenElement === "head" && headContentElements.length > 0) {
      const currentHeadContent =
        headContentElements[headContentElements.length - 1];
      if (tag.closing && tag.name === currentHeadContent) {
        headContentElements.pop();
      } else if (
        currentHeadContent === "template" &&
        !tag.closing &&
        HEAD_CONTENT_CONTAINER_NAMES.has(tag.name)
      ) {
        headContentElements.push(tag.name);
      }
    } else if (
      hiddenElement === "head" &&
      !tag.closing &&
      HEAD_CONTENT_CONTAINER_NAMES.has(tag.name)
    ) {
      headContentElements.push(tag.name);
    } else if (
      hiddenElement === "head" &&
      !tag.closing &&
      !HEAD_ELEMENT_NAMES.has(tag.name)
    ) {
      hiddenElement = null;
      hiddenDepth = 0;
      copyFrom = tagStart;
    } else if (tag.name === hiddenElement) {
      if (
        hiddenElement === "template" &&
        !tag.closing
      ) {
        hiddenDepth += 1;
      } else if (tag.closing) {
        hiddenDepth -= 1;
        if (hiddenDepth === 0) {
          hiddenElement = null;
          copyFrom = tag.end;
        }
      }
    }

    cursor = parsedTag.nextCursor;
  }

  if (!hiddenElement) {
    output.push(adSlotStripped.slice(copyFrom));
  }
  return output.join("");
}

/**
 * Remove third-party ad containers before any signal extraction. Ad-slot
 * creatives rotate independently of the page's own offer, price, CTA, and
 * form structure, so their text must never feed the customer-facing change
 * diff. This is a tolerant pre-pass over the same hand-rolled scanner as the
 * main pass; unclosable regions fail safe (kept) rather than risk eating
 * real content that follows malformed ad markup.
 */
function stripAdSlotRegions(html: string) {
  const output: string[] = [];
  let copyFrom = 0;
  let cursor = 0;
  while (cursor < html.length) {
    const tagStart = html.indexOf("<", cursor);
    if (tagStart < 0) break;
    const prefix = readHtmlTagPrefix(html, tagStart);
    if (!prefix) {
      cursor = tagStart + 1;
      continue;
    }
    if (prefix.closing) {
      cursor = tagStart + 1;
      continue;
    }
    if (AD_SLOT_OPAQUE_TAG_NAMES.has(prefix.name)) {
      // Script/style/template text can contain tag-looking markup (JS
      // strings, CSS content). Skip to the real closing tag so a fake
      // "<div class=ad>" inside a string can never trigger a strip.
      const opaqueEnd = findOpaqueContainerEnd(html, tagStart, prefix.name);
      cursor = opaqueEnd ?? html.length;
      continue;
    }
    const parsedTag = readHtmlTag(html, tagStart);
    if (!parsedTag.tag) {
      cursor = parsedTag.nextCursor;
      continue;
    }
    if (
      !isAdSlotContainerTag(
        prefix.name,
        html.slice(tagStart, parsedTag.tag.end),
      )
    ) {
      cursor = parsedTag.tag.end;
      continue;
    }
    const regionEnd = findAdSlotRegionEnd(
      html,
      tagStart,
      prefix.name,
      parsedTag.tag.end,
    );
    if (regionEnd === null) {
      // Unbounded ad region: keep it (current behavior) instead of
      // stripping the rest of the page.
      cursor = tagStart + 1;
      continue;
    }
    output.push(html.slice(copyFrom, tagStart), " ");
    copyFrom = regionEnd;
    cursor = regionEnd;
  }
  output.push(html.slice(copyFrom));
  return output.join("");
}

function isAdSlotContainerTag(name: string, tagText: string) {
  if (AD_SLOT_BARE_TAG_NAMES.has(name)) {
    return true;
  }
  return tagCarriesAdSlotMarker(tagText);
}

function tagCarriesAdSlotMarker(tagText: string) {
  if (tagCarriesAdSlotDataAttribute(tagText)) {
    return true;
  }
  const id = readAttributeValue(tagText, "id") ?? "";
  const className = readAttributeValue(tagText, "class") ?? "";
  const tokens = `${id} ${className}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return tokens.some((token) => AD_SLOT_MARKER_TOKENS.has(token));
}

// Google Ad Manager emits ad slots as bare `<div>` (or `<amp-ad>`) elements
// with attribute names like `data-ad-slot` and no id/class. The id/class
// token check above never sees them, so this path reads the tag's attribute
// NAMES only — the values are numeric slot IDs / client codes, never copy.
// Only the attribute names in AD_SLOT_DATA_ATTRIBUTE_NAMES matter; an empty
// attribute (e.g. `data-ad-slot`) keeps the marker because the page itself
// declared the slot.
function tagCarriesAdSlotDataAttribute(tagText: string) {
  for (const attribute of AD_SLOT_DATA_ATTRIBUTE_NAMES) {
    if (hasAttributeName(tagText, attribute)) {
      return true;
    }
  }
  return false;
}

/** Return the index just past the closing tag, or null when never closed. */
function findOpaqueContainerEnd(
  html: string,
  tagStart: number,
  name: string,
) {
  let cursor = tagStart + 1;
  let depth = 1;
  while (cursor < html.length) {
    const nextTag = html.indexOf("<", cursor);
    if (nextTag < 0) return null;
    const parsedTag = readHtmlTag(html, nextTag);
    const tag = parsedTag.tag;
    cursor = parsedTag.nextCursor;
    if (!tag || tag.name !== name) continue;
    if (tag.closing) {
      depth -= 1;
      if (depth === 0) {
        return parsedTag.nextCursor;
      }
      continue;
    }
    // Only templates nest legitimately; script/style use first-close-wins
    // (a "<script>" inside a JS string is not a real element).
    if (name === "template") {
      depth += 1;
    }
  }
  return null;
}

/**
 * Find the end of an ad-slot region opened at tagStart. Same-name nesting is
 * tracked; script/style/template subtrees inside the region are skipped
 * opaquely. Returns null (fail safe) when no closing tag appears within the
 * scan bound.
 */
function findAdSlotRegionEnd(
  html: string,
  tagStart: number,
  name: string,
  afterOpenTag: number,
) {
  let cursor = afterOpenTag;
  let depth = 1;
  while (cursor < html.length) {
    if (cursor - tagStart > AD_SLOT_REGION_SCAN_LIMIT) {
      return null;
    }
    const nextTag = html.indexOf("<", cursor);
    if (nextTag < 0) return null;
    if (nextTag - tagStart > AD_SLOT_REGION_SCAN_LIMIT) {
      return null;
    }
    const parsedTag = readHtmlTag(html, nextTag);
    const tag = parsedTag.tag;
    cursor = parsedTag.nextCursor;
    if (!tag) continue;
    if (tag.closing && tag.name === name) {
      depth -= 1;
      if (depth === 0) {
        return parsedTag.nextCursor;
      }
      continue;
    }
    if (!tag.closing && tag.name === name) {
      depth += 1;
      continue;
    }
    if (!tag.closing && AD_SLOT_OPAQUE_TAG_NAMES.has(tag.name)) {
      const opaqueEnd = findOpaqueContainerEnd(html, nextTag, tag.name);
      if (opaqueEnd !== null) {
        cursor = opaqueEnd;
      }
    }
  }
  return null;
}

function readAttributeValue(tagText: string, attribute: string) {
  const pattern = new RegExp(
    `\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\\\`]+))`,
    "i",
  );
  const match = tagText.match(pattern);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? "";
}

// Presence-only attribute check (no value required). Walks the tag text
// outside quoted regions so an attribute name that appears inside a class
// value (`class="data-ad-slot is hidden"`) never falsely matches. Boolean
// attributes (`<div data-ad-slot>`) are recognised because we only check
// the name — the value is meaningless for ad-slot identification.
function hasAttributeName(tagText: string, name: string) {
  const lower = name.toLowerCase();
  let cursor = 0;
  if (tagText[cursor] === "<") cursor += 1;
  while (cursor < tagText.length && /[a-z0-9:_-]/i.test(tagText[cursor] ?? "")) {
    cursor += 1;
  }
  while (cursor < tagText.length) {
    const ch = tagText[cursor];
    if (ch === '"' || ch === "'") {
      const end = tagText.indexOf(ch, cursor + 1);
      if (end < 0) return false;
      cursor = end + 1;
      continue;
    }
    if (ch === ">") return false;
    if (/\s/.test(ch ?? "")) {
      cursor += 1;
      continue;
    }
    const start = cursor;
    while (cursor < tagText.length && /[a-z0-9:_-]/i.test(tagText[cursor] ?? "")) {
      cursor += 1;
    }
    if (tagText.slice(start, cursor).toLowerCase() === lower) {
      return true;
    }
    while (cursor < tagText.length) {
      const next = tagText[cursor];
      if (next === '"' || next === "'" || /\s/.test(next ?? "") || next === ">") {
        break;
      }
      cursor += 1;
    }
  }
  return false;
}

function extractButtonText(html: string) {
  return [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)].map((match) => stripTags(match[1] ?? ""));
}

function extractSubmitValues(html: string) {
  return extractHtmlStartTags(html, "input")
    .filter((tag) => readAttribute(tag, "type")?.toLowerCase() === "submit")
    .map((tag) => readAttribute(tag, "value") ?? "");
}

function extractActionLinks(html: string) {
  return [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map((match) => stripTags(match[1] ?? ""));
}

function pickBestCta(
  candidates: string[],
  buttonCandidates: string[] = [],
  anchorCandidates: string[] = [],
): { ctaText: string | null; funnel: CtaFunnel } {
  const unique = [...new Set(candidates.filter(Boolean))];

  for (const pattern of CTA_PRIORITY_PATTERNS) {
    const match = unique.find((candidate) => pattern.test(candidate));
    if (match) {
      return { ctaText: match, funnel: { stage: "reached", reasonCode: null } };
    }
  }

  // v5 fallback (issue #949): no priority verb matched. Before this fallback
  // the detector returned null, which made the CTA diff permanently blind to
  // any page whose CTA verb was not in the priority list — a real CTA change
  // on such a page could never fire. A `<button>` is an action control, so
  // its text is a real CTA even without a priority verb. Pick the first
  // non-trivial, non-chrome button so the diff can see genuine changes.
  // Submit inputs are NOT used for the fallback: submit values usually carry
  // priority verbs already.
  for (const candidate of buttonCandidates) {
    if (!candidate) continue;
    if (isChromeButtonText(candidate)) continue;
    return { ctaText: candidate, funnel: { stage: "reached", reasonCode: null } };
  }

  // v6 fallback (issue #1401): no priority verb AND no usable button. Before
  // this tier the detector returned null for every page whose only CTA is a
  // generic anchor — the dominant remaining bail-out (the CTA detector was
  // silent for 75 days). A BLIND anchor fallback is wrong (links are often
  // navigation), so this is selective: the first action link whose text is
  // not navigation chrome (CTA_CHROME_ANCHOR_TEXTS). Soft CTAs ("Learn more",
  // "Read more", "Find out more") flow through; pure nav (About, Home, Login)
  // is blocked so the diff never watches a rotating nav label.
  const usableAnchor = anchorCandidates.find(
    (candidate) => Boolean(candidate) && !isChromeAnchorText(candidate),
  );
  if (usableAnchor) {
    return { ctaText: usableAnchor, funnel: { stage: "reached", reasonCode: null } };
  }

  // Bail-out: name the gate so a backfill / log query can surface the
  // dominant reason (issue #1401 accept 4). The reason is derived from what
  // existed upstream of the fallbacks.
  const reasonCode = classifyCtaBail(
    buttonCandidates,
    anchorCandidates,
  );
  return { ctaText: null, funnel: { stage: "bailed", reasonCode } };
}

function classifyCtaBail(
  buttonCandidates: string[],
  anchorCandidates: string[],
): CtaFunnelReasonCode {
  const hasButton = buttonCandidates.some(Boolean);
  const hasAnchor = anchorCandidates.some(Boolean);
  if (!hasButton && !hasAnchor) {
    return "no_cta_candidates";
  }
  // Buttons existed but every one was chrome (else the button fallback would
  // have returned). Anchors either did not exist or were all chrome.
  if (hasButton && !hasAnchor) {
    return "only_chrome_buttons";
  }
  if (hasAnchor && !hasButton) {
    return "only_chrome_anchors";
  }
  // Both existed but all were chrome.
  return "only_chrome_buttons";
}

// Strip bidi / format marks (e.g. U+200E LEFT-TO-RIGHT MARK that Calendly
// appends to "Cookie Details") and collapse whitespace so chrome matching
// is stable across rendered captures.
function normalizeChromeText(candidate: string): string {
  return candidate
    .replace(/[\u200E\u200F\u200B\u200C\u200D\uFEFF]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Chrome matching for the button fallback. Exact set membership is not enough:
// live captures also carry "Search… Ctrl K", day-of-month digits ("1".."31"),
// and timezone labels ("UTC Time (12:01am)") that are UI chrome, not CTAs.
// Prefix/pattern rules keep the blocklist small while covering those shapes
// without swallowing commercial verbs ("Search our catalog" still flows
// through because it does not start with bare "search" + punctuation).
function isChromeButtonText(candidate: string): boolean {
  const lower = normalizeChromeText(candidate);
  if (!lower) return true;
  if (CTA_CHROME_BUTTON_TEXTS.has(lower)) return true;
  // Digit-only calendar cells.
  if (/^\d{1,2}$/.test(lower)) return true;
  // Search affordances: "Search", "Search…", "Search… Ctrl K".
  if (/^search\b/.test(lower)) return true;
  // Cookie-consent chrome variants ("Cookie Details", "Cookie settings").
  if (/^cookie\b/.test(lower)) return true;
  // Password-recovery chrome on login walls.
  if (/\bpassword\b/.test(lower)) return true;
  // Timezone / clock chrome on booking widgets.
  if (/\btime\b/.test(lower) && /\b(utc|gmt|am|pm)\b/.test(lower)) return true;
  return false;
}

function isChromeAnchorText(candidate: string): boolean {
  const lower = normalizeChromeText(candidate);
  if (!lower) return true;
  if (CTA_CHROME_ANCHOR_TEXTS.has(lower)) return true;
  // Same cookie / password / search chrome that can appear as <a> text.
  if (/^cookie\b/.test(lower)) return true;
  if (/\bpassword\b/.test(lower)) return true;
  if (/^search\b/.test(lower)) return true;
  return false;
}

function pickPrice(html: string, declaredCurrency: string | null = null) {
  const text = cleanText(stripTags(html));

  // Pass 1 (issue #2861): when the page declares a currency, prefer the
  // first candidate whose marker is consistent with it, keeping the
  // existing pattern-priority order. A geo-localized string in another
  // currency (the allbirds "£50" shipping bar on a USD shop) can sit ahead
  // of the real price in text order; the declaration disambiguates it.
  if (declaredCurrency !== null) {
    for (const pattern of PRICE_PATTERNS) {
      const preferred = firstCandidateForDeclaredCurrency(
        text,
        pattern,
        declaredCurrency,
      );
      if (preferred !== null) {
        return cleanText(preferred);
      }
    }
  }

  // Pass 2: historical behaviour — first match of the first pattern that
  // matches. Reached when the page declares nothing or declares a currency
  // no candidate carries, so the anchor can never blank a price.
  for (const pattern of PRICE_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return cleanText(match[1]);
    }
  }

  return null;
}

/**
 * Resolve the currency a page declares for itself: Shopify/Shop Pay
 * `currencyCode`, JSON-LD `priceCurrency`, generic `"currency"` fields,
 * `currency = 'USD'` assignments, Shopify's `{"active":"USD"}` money object,
 * and `og:price:currency`/`product:price:currency` meta tags. Read from the
 * RAW html — the declarations live in script/head markup that is stripped
 * before visible-text matching, so this runs pre-strip.
 *
 * Majority vote across every declaration found, earliest occurrence winning
 * ties — deterministic for a given page version, and robust to one stray
 * embed (a widget cart blob in another currency loses to the shop's own
 * repeated declaration). Returns null when nothing plausible is declared.
 */
export function pickDeclaredCurrency(html: string): string | null {
  const tally = new Map<string, { count: number; firstIndex: number }>();
  for (const pattern of DECLARED_CURRENCY_PATTERNS) {
    const global = new RegExp(
      pattern.source,
      pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
    );
    let match: RegExpExecArray | null;
    while ((match = global.exec(html)) !== null) {
      const code = match[1]?.toUpperCase();
      if (code && KNOWN_CURRENCY_CODES.has(code)) {
        const entry = tally.get(code) ?? { count: 0, firstIndex: match.index };
        entry.count += 1;
        entry.firstIndex = Math.min(entry.firstIndex, match.index);
        tally.set(code, entry);
      }
      if (match[0].length === 0) {
        global.lastIndex += 1;
      }
    }
  }
  let best: string | null = null;
  let bestCount = 0;
  let bestIndex = Number.POSITIVE_INFINITY;
  for (const [code, entry] of tally) {
    if (
      entry.count > bestCount ||
      (entry.count === bestCount && entry.firstIndex < bestIndex)
    ) {
      best = code;
      bestCount = entry.count;
      bestIndex = entry.firstIndex;
    }
  }
  return best;
}

/** Every candidate of `pattern` in text order, not just the first. */
function allPatternCandidates(text: string, pattern: RegExp): string[] {
  const global = new RegExp(pattern.source, `${pattern.flags}g`);
  const candidates: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = global.exec(text)) !== null) {
    if (match[1]) {
      candidates.push(match[1]);
    }
    if (match[0].length === 0) {
      global.lastIndex += 1;
    }
  }
  return candidates;
}

function firstCandidateForDeclaredCurrency(
  text: string,
  pattern: RegExp,
  declaredCurrency: string,
): string | null {
  for (const candidate of allPatternCandidates(text, pattern)) {
    if (candidateMatchesCurrency(candidate, declaredCurrency)) {
      return candidate;
    }
  }
  return null;
}

/**
 * True when a matched price string's marker is consistent with the page's
 * declared currency. Explicit codes ("USD 100") must equal it; symbols map
 * through CURRENCY_MARKER_CODES so "$" satisfies USD/AUD/CAD/… declarations
 * while "£" only satisfies GBP. "Rs"/"₹" candidates satisfy INR.
 * Markerless candidates ("% off", "buy 2 get 1") never match — they fall
 * through to the historical pass.
 */
function candidateMatchesCurrency(
  candidate: string,
  declaredCurrency: string,
): boolean {
  const codeMatch = /\b([a-z]{3})\b/i.exec(candidate);
  if (codeMatch && KNOWN_CURRENCY_CODES.has(codeMatch[1]!.toUpperCase())) {
    return codeMatch[1]!.toUpperCase() === declaredCurrency;
  }
  const symbolMatch = /[$€£₹¥₽₩]/.exec(candidate);
  if (symbolMatch) {
    return CURRENCY_MARKER_CODES[symbolMatch[0]]?.has(declaredCurrency) ?? false;
  }
  return /\brs\b\.?/i.test(candidate) && declaredCurrency === "INR";
}

function detectFormPresence(html: string) {
  if (/<form\b/i.test(html)) {
    return true;
  }

  const inputTags = extractHtmlStartTags(html, "input");
  const hasLeadInputs = [
    ...inputTags,
    ...extractHtmlStartTags(html, "textarea"),
  ].some((tag) =>
    [
      readAttribute(tag, "type"),
      readAttribute(tag, "name"),
      readAttribute(tag, "placeholder"),
      readAttribute(tag, "autocomplete"),
      readAttribute(tag, "aria-label"),
      readAttribute(tag, "id"),
    ].some(isLeadFieldValue),
  );
  const hasSubmitAction =
    inputTags.some(
      (tag) => readAttribute(tag, "type")?.toLowerCase() === "submit",
    ) ||
    extractHtmlStartTags(html, "button").some(
      (tag) => readAttribute(tag, "type")?.toLowerCase() === "submit",
    );

  return hasLeadInputs && hasSubmitAction;
}

function isLeadFieldValue(value: string | null) {
  if (!value) return false;
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ");
  return LEAD_FIELD_PATTERN.test(normalized);
}

function extractHtmlStartTags(html: string, tagName: string) {
  const tags: string[] = [];
  let cursor = 0;
  while (cursor < html.length) {
    const tagStart = html.indexOf("<", cursor);
    if (tagStart < 0) break;
    const parsedTag = readHtmlTag(html, tagStart);
    const tag = parsedTag.tag;
    if (!tag) {
      cursor = parsedTag.nextCursor;
      continue;
    }
    if (!tag.closing && tag.name === tagName) {
      tags.push(html.slice(tagStart, tag.end));
    }
    cursor = parsedTag.nextCursor;
  }
  return tags;
}

function readHtmlTag(
  html: string,
  start: number,
  maxScanLength = MAX_HTML_TAG_SCAN_LENGTH,
  recoverNestedTagStarts = true,
  preferredClosingTagName: string | null = null,
) {
  const prefix = readHtmlTagPrefix(html, start);
  if (!prefix) {
    return {
      nextCursor: Math.min(html.length, start + 1),
      tag: null,
    };
  }
  const { closing, name, nameEnd, nameStart } = prefix;
  let cursor = nameEnd;

  let quote: "\"" | "'" | null = null;
  let preferredClosingTagRecoveryStart: number | null = null;
  let hiddenTagRecoveryStart: number | null = null;
  let nestedTagRecoveryStart: number | null = null;
  const scanLimit = Math.min(html.length, cursor + maxScanLength);
  for (; cursor < scanLimit; cursor += 1) {
    const character = html[cursor];
    if (quote) {
      if (character === quote) {
        quote = null;
        continue;
      }
      const nestedPrefix =
        recoverNestedTagStarts && character === "<"
          ? readHtmlTagPrefix(html, cursor)
          : null;
      if (nestedPrefix) {
        // A less-than sequence is legal inside a quoted attribute. Remember
        // it only as a recovery point; use it if the containing tag never
        // closes, otherwise keep the attribute intact. Retaining the latest
        // point also keeps repeated malformed prefixes linear.
        nestedTagRecoveryStart = cursor;
        if (
          preferredClosingTagRecoveryStart === null &&
          nestedPrefix.closing &&
          nestedPrefix.name === preferredClosingTagName
        ) {
          preferredClosingTagRecoveryStart = cursor;
        }
        if (
          hiddenTagRecoveryStart === null &&
          !nestedPrefix.closing &&
          HIDDEN_RECOVERY_TAG_NAMES.has(nestedPrefix.name)
        ) {
          hiddenTagRecoveryStart = cursor;
        }
      }
      continue;
    }
    const nestedPrefix =
      recoverNestedTagStarts && character === "<"
        ? readHtmlTagPrefix(html, cursor)
        : null;
    if (nestedPrefix) {
      // Browsers keep "<" in unquoted attribute values, so do not abort a
      // tag that later closes. This point is used only if the bounded scan
      // fails, preserving tags that begin near the end of that window.
      nestedTagRecoveryStart = cursor;
      if (
        preferredClosingTagRecoveryStart === null &&
        nestedPrefix.closing &&
        nestedPrefix.name === preferredClosingTagName
      ) {
        preferredClosingTagRecoveryStart = cursor;
      }
      if (
        hiddenTagRecoveryStart === null &&
        !nestedPrefix.closing &&
        HIDDEN_RECOVERY_TAG_NAMES.has(nestedPrefix.name)
      ) {
        hiddenTagRecoveryStart = cursor;
      }
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character !== ">") continue;

    let beforeEnd = cursor - 1;
    while (beforeEnd > nameStart && /\s/.test(html[beforeEnd] ?? "")) {
      beforeEnd -= 1;
    }
    return {
      nextCursor: cursor + 1,
      tag: {
        closing,
        end: cursor + 1,
        name,
        selfClosing: !closing && html[beforeEnd] === "/",
      },
    };
  }

  return {
    nextCursor:
      preferredClosingTagRecoveryStart ??
      hiddenTagRecoveryStart ??
      nestedTagRecoveryStart ??
      scanLimit,
    tag: null,
  };
}

function readHtmlTagPrefix(html: string, start: number) {
  let cursor = start + 1;
  const closing = html[cursor] === "/";
  if (closing) cursor += 1;

  const nameStart = cursor;
  while (cursor < html.length && /[a-z0-9:_-]/i.test(html[cursor] ?? "")) {
    cursor += 1;
  }
  if (cursor === nameStart) return null;
  return {
    closing,
    name: html.slice(nameStart, cursor).toLowerCase(),
    nameEnd: cursor,
    nameStart,
  };
}

function readAttribute(
  tag: string,
  attribute:
    | "type"
    | "value"
    | "name"
    | "placeholder"
    | "autocomplete"
    | "aria-label"
    | "id",
) {
  for (const match of tag.matchAll(
    /\b([a-z][a-z0-9:_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi,
  )) {
    if (match[1]?.toLowerCase() === attribute) {
      return match[2] ?? match[3] ?? match[4] ?? "";
    }
  }
  return null;
}

function stripTags(value: string) {
  const output: string[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const tagStart = value.indexOf("<", cursor);
    if (tagStart < 0) {
      output.push(value.slice(cursor));
      break;
    }
    output.push(value.slice(cursor, tagStart), " ");
    const tagEnd = value.indexOf(">", tagStart + 1);
    if (tagEnd < 0) break;
    cursor = tagEnd + 1;
  }
  return output.join("");
}

// Issue #1409 guard: hex entities for lone surrogates (0xd800-0xdfff) and
// out-of-range scalars (> 0x10ffff) must survive decoding untouched — decoding
// them would put invalid characters into ctaText and corrupt downstream
// JSON/DB. The shared decoder does not carry this guard, so shield the guarded
// entities from it and restore them afterwards.
const GUARDED_HEX_ENTITY_RE =
  /&#x(?:0*[dD][89AaBb][0-9A-Fa-f]{2}|0*1[1-9A-Fa-f][0-9A-Fa-f]{4,5});/g;
const GUARDED_HEX_ENTITY_TEST_RE =
  /&#x(?:0*[dD][89AaBb][0-9A-Fa-f]{2}|0*1[1-9A-Fa-f][0-9A-Fa-f]{4,5});/;
const SHIELD = "\u0000";

function shieldGuardedHexEntities(value: string) {
  // Store without the leading `&` so the shielded form is no longer an entity
  // the decoder would match.
  return value.replace(GUARDED_HEX_ENTITY_RE, (entity) => SHIELD + entity.slice(1) + SHIELD);
}

function restoreGuardedHexEntities(value: string) {
  return value.replace(
    new RegExp(`${SHIELD}([^\u0000]{1,24})${SHIELD}`, "g"),
    (_match, stored: string) => {
      const entity = "&" + stored;
      return GUARDED_HEX_ENTITY_TEST_RE.test(entity) ? entity : _match;
    },
  );
}

function cleanText(value: string) {
  // Issue #2455: the local decodeHtml here omitted `&nbsp;` (and other named
  // entities), so entity-joined CTA text like "Buy&nbsp;Now" was stored
  // literally. Use the one shared single-pass decoder instead, with the
  // issue-#1409 guard shielded around it.
  return restoreGuardedHexEntities(
    decodeHtmlEntities(shieldGuardedHexEntities(value)),
  )
    .replace(/\s+/g, " ")
    .trim();
}

// Issue #1500: UTF-8 byte-length helper for the lp_run_audit lines. Lives at
// the bottom of the file (alongside cleanText) so it is defined
// before extractLandingPageSignals runs. The existing app/lib/bounded-response.server.ts
// helper is intentionally NOT imported here — this file is exercised by
// vitest in isolation and the run-audit module already carries its own
// TextEncoder-based fallback. The local helper exists so the audit code in
// extractLandingPageSignals can measure bytes without a cross-file import.
function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
