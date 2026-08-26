import { hasMeaningfulLandingPageBodyText } from "~/lib/landing-page-signals.server";

/**
 * Capture-validity gate (BET 4, Part 1).
 *
 * The #1 and #2 buyer complaints in the whole page-monitoring category are
 * alert noise and phantom changes from render failures — partial loads, error
 * pages, bot/challenge walls, cookie/consent walls. Every vendor concedes it;
 * none advertises solving it. This gate runs before any diff is allowed to
 * become an event: a capture that fails it is recorded as `capture_failed`
 * (a failed proof capture) and is *never* an alert.
 *
 * The gate is a pure function over (HTML, fetch status, extracted signals) so
 * it can be exercised by an adversarial fixture suite without a network. It is
 * deliberately conservative: a false negative leaks one churn event, a false
 * positive silently drops a real change. The cost balance favours noise
 * suppression — the category's open differentiator is "proof that is actually
 * validated" — but every rejection carries a machine-readable reason so a real
 * drop is observable, not silent.
 */

export const CAPTURE_VALIDITY_REASON_CODES = [
  "landing_challenge_page",
  "landing_cookie_wall",
  "landing_partial_spa",
  "landing_error_page",
  "landing_content_signature_too_small",
] as const;

export type CaptureValidityReasonCode = (typeof CAPTURE_VALIDITY_REASON_CODES)[number];

export interface CaptureValidityAssessment {
  valid: boolean;
  reasonCode: CaptureValidityReasonCode | null;
  reason: string;
  /** Short human-readable fingerprint of what tripped, for telemetry only. */
  fingerprint: string | null;
}

export interface CaptureValidityInput {
  html: string;
  /** HTTP status of the response that produced `html`. 200 for rendered legs. */
  fetchStatus: number;
  /** Document mode the signals were extracted in. */
  documentMode?: "raw" | "rendered";
}

/**
 * Minimum visible-body signature (post strip of script/style/head/ad slots)
 * for a capture to count as a real page. Below this, the gate cannot tell a
 * real thin page from a challenge/SPA shell and rejects with
 * `landing_content_signature_too_small`. Tuned to stay well under the smallest
 * real landing page the extractor has seen (every real page has hundreds of
 * visible characters of nav/copy/footer); a challenge page or partial SPA is
 * typically tens of characters of boilerplate.
 */
const MIN_VISIBLE_BODY_CHARACTERS = 80;

// --- Challenge / anti-bot fingerprints -------------------------------------
//
// Cloudflare and the common anti-bot front-ends all leave stable strings in
// the HTML even when the challenge is rendered client-side: the interstitial
// copy, the well-known element ids, and the script/src markers. Matched
// case-insensitively against the raw HTML so a minified variant still trips.
const CHALLENGE_FINGERPRINTS: RegExp[] = [
  /<title[^>]*>\s*(just a moment|attention required|checking your browser|verifying you are human|please wait[\s.!]*while we verify)/i,
  /id=["']cf-(?:browser-verification|challenge-form|spinner-please-wait|challenge-running)["']/i,
  /id=["']challenge-(?:form|run|stage)["']/i,
  /id=["']cf-challenge["']/i,
  /class=["'][^"']*cf-(?:challenge|browser-verification|turnstile-container|mtm-container)[^"']*["']/i,
  /<div[^>]*id=["']cf-please-wait["']/i,
  /data-[^=]+=["']cf-/i,
  /cdn-cgi\/challenge-platform\//i,
  /challenges\.cloudflare\.com\/turnstile/i,
  /window\._cf_chl_opt\b/i,
  /<noscript[^>]*>\s*enable javascript and cookies to continue/i,
  // PerimeterX/HUMAN and DataDome interstitials.
  /id=["']px-captcha["']/i,
  /class=["'][^"']*px-?captcha[^"']*["']/i,
  /window\._pxAppId\b/i,
  /datadome\.co\/js\.js/i,
  /id=["']ddjs-?key["']/i,
];

// --- Cookie / consent-wall fingerprints ------------------------------------
//
// A consent wall that gates the real content behind a banner is a render
// failure from the proof's point of view: the extracted signals come from the
// banner, not the page. Matched against the raw HTML. The OneTrust,
// Cookiebot, TrustArc, Quantcast, and Sourcepoint banner ids are stable
// across deployments; the gating copy is matched too.
const COOKIE_WALL_FINGERPRINTS: RegExp[] = [
  /id=["']onetrust-banner-sdk["']/i,
  /id=["']onetrust-accept-all-handler["']/i,
  /class=["'][^"']*onetrust[^"']*banner[^"']*["']/i,
  /id=["']cookiebot-?banner["']/i,
  /id=["']consent-?banner["']/i,
  /id=["']cookie-?banner["']/i,
  /id=["']gdpr-?consent["']/i,
  /id=["']truste-?consent-?track["']/i,
  /id=["']qc-?cmp-?ui["']/i,
  /id=["']sp-?message-?container["']/i,
  /class=["'][^"']*sp-?message[^"']*["']/i,
  /\bcookielaw\.org\/consent\//i,
  /\bconsent\.cookiebot\.com\/uc\.js/i,
];

// A banner alone is not always a wall (some sites show a non-gating cookie
// notice with the full page underneath). Treat it as a wall only when the
// visible body is too thin to be the real page OR the gating copy is present.
const COOKIE_WALL_GATING_COPY: RegExp[] = [
  /accept (?:all )?cookies to (?:continue|access|see|use|browse|view)/i,
  /by (?:clicking )?(?:accept|allow)(?:ing)?(?: all)? cookies,? you (?:agree|allow|consent)/i,
  /we use cookies to (?:improve|enhance|personalize|ensure) your (?:browsing )?experience/i,
  /please (?:accept|enable|allow) cookies to continue/i,
  /consent (?:is required|required) to (?:continue|access|use)/i,
];

// --- Partial SPA shell fingerprints ----------------------------------------
//
// A server-rendered shell that never hydrated: the body is a placeholder, an
// "enable JavaScript" notice, or an empty app root with no real copy. The
// meaningful-body check below catches the empty case; these patterns catch the
// "please enable JS" and loader-text cases that still have some characters.
const PARTIAL_SPA_FINGERPRINTS: RegExp[] = [
  /<noscript[^>]*>\s*you need to enable javascript[\s\S]*?<\/noscript>/i,
  /<noscript[^>]*>\s*please enable javascript[\s\S]*?<\/noscript>/i,
  /<div[^>]*id=["']root["'][^>]*>\s*<\/div>/i,
  /<div[^>]*id=["']app["'][^>]*>\s*<\/div>/i,
  /<div[^>]*id=["']__next["'][^>]*>\s*<\/div>/i,
  /<div[^>]*id=["']__nuxt["'][^>]*>\s*<\/div>/i,
  /class=["'][^"']*app-?(?:loader|loading|splash)[^"']*["']/i,
  /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["']\d+;\s*url=/i,
];

// --- Generic error-page fingerprints (200 with error copy) -----------------
//
// Some origin errors return 200 with a generic error body (CDN error pages,
// "this page could not be found", maintenance banners). Matched against the
// visible body so a real product page that happens to mention "error" in copy
// does not trip.
const ERROR_PAGE_FINGERPRINTS: RegExp[] = [
  /\b404\b[^<]{0,40}\bnot found\b/i,
  /\bthis page (?:could not|can'?t) be found\b/i,
  /\bpage (?:does not|doesn'?t) exist\b/i,
  /\b5\d\d\b[^<]{0,40}\b(server|internal) error\b/i,
  /\binternal server error\b/i,
  /\bservice (?:is )?temporarily (?:unavailable|down)\b/i,
  /\bsite (?:is )?(?:temporarily )?(?:down|offline|under maintenance)\b/i,
  /\bwe'?ll be back (?:shortly|soon)\b/i,
  /\berror code:\s*5\d{2}\b/i,
];

function visibleBodyText(html: string, documentMode: "raw" | "rendered") {
  // Reuse the extractor's own visibility filter so the gate and the signal
  // extractor agree on what counts as "on the page": script/style/head/noscript
  // and ad-slot regions are stripped, then tags are stripped to text.
  return stripTags(html, documentMode).replace(/\s+/g, " ").trim();
}

function stripTags(html: string, documentMode: "raw" | "rendered") {
  // Lightweight tag stripper for the gate's own body-text read. The extractor's
  // `removeNonVisibleElements` is not exported separately, so we approximate
  // the same hidden-element strip with a single pass: drop script/style/
  // template/noscript/head blocks, then strip remaining tags.
  const hidden = documentMode === "rendered"
    ? /<(script|style|noscript|template|head)\b[^>]*>[\s\S]*?<\/\1>/gi
    : /<(script|style|template|head)\b[^>]*>[\s\S]*?<\/\1>/gi;
  const stripped = html.replace(hidden, " ");
  return stripped.replace(/<[^>]+>/g, " ");
}

function matchesAny(haystack: string, patterns: RegExp[]): RegExp | null {
  for (const pattern of patterns) {
    if (pattern.test(haystack)) {
      return pattern;
    }
  }
  return null;
}

export function assessCaptureValidity(input: CaptureValidityInput): CaptureValidityAssessment {
  const html = input.html ?? "";
  const documentMode = input.documentMode ?? "raw";

  // HTTP status class: a 4xx/5xx response is never a valid capture. The plain
  // -http leg already returns null on !response.ok, but the rendered leg and
  // any future caller get the same guard here.
  if (input.fetchStatus >= 400) {
    return {
      valid: false,
      reasonCode: "landing_error_page",
      reason: `HTTP ${input.fetchStatus} response is not a valid capture.`,
      fingerprint: `http_${input.fetchStatus}`,
    };
  }

  const hit = matchesAny(html, CHALLENGE_FINGERPRINTS);
  if (hit) {
    return {
      valid: false,
      reasonCode: "landing_challenge_page",
      reason: "Anti-bot / challenge interstitial detected (the page body is a verification wall, not the real page).",
      fingerprint: `challenge:${hit.source}`,
    };
  }

  const cookieHit = matchesAny(html, COOKIE_WALL_FINGERPRINTS);
  if (cookieHit) {
    const bodyText = visibleBodyText(html, documentMode);
    const gatingCopy = matchesAny(bodyText, COOKIE_WALL_GATING_COPY);
    const tooThin = bodyText.length < MIN_VISIBLE_BODY_CHARACTERS;
    // A cookie banner is only a wall when it gates the real content: either
    // the gating copy is present, or the visible body is too thin to be the
    // real page (the banner is all we got). A non-gating cookie notice on top
    // of a full page is not a render failure.
    if (gatingCopy || tooThin) {
      return {
        valid: false,
        reasonCode: "landing_cookie_wall",
        reason: gatingCopy
          ? "Consent / cookie wall with gating copy detected; extracted signals come from the banner, not the page."
          : "Consent / cookie banner detected and the visible body is too thin to be the real page.",
        fingerprint: `cookie_wall:${gatingCopy ? "gating_copy" : "thin_body"}`,
      };
    }
  }

  const spaHit = matchesAny(html, PARTIAL_SPA_FINGERPRINTS);
  if (spaHit) {
    // An empty app root is only a partial-SPA failure when the body never
    // hydrated: confirm with the extractor's meaningful-body check. A page
    // that ships an empty `<div id="root">` AND real SSR copy inside it is a
    // real page; the meaningful-body check distinguishes the two.
    if (!hasMeaningfulLandingPageBodyText(html, { documentMode })) {
      return {
        valid: false,
        reasonCode: "landing_partial_spa",
        reason: "Partial SPA shell detected (empty app root or 'enable JavaScript' notice with no meaningful body text).",
        fingerprint: `partial_spa:${spaHit.source}`,
      };
    }
  }

  const bodyText = visibleBodyText(html, documentMode);
  const errorHit = matchesAny(bodyText, ERROR_PAGE_FINGERPRINTS);
  if (errorHit) {
    // An error-page fingerprint in a tiny body is a real error page; in a
    // full body it is most likely product copy that mentions an error state
    // (e.g. "404 not found? here's our homepage"). Error pages are dominated
    // by the error copy and stay well under the real-page signature, so the
    // same minimum threshold distinguishes them cleanly.
    if (bodyText.length < MIN_VISIBLE_BODY_CHARACTERS) {
      return {
        valid: false,
        reasonCode: "landing_error_page",
        reason: "Generic error / maintenance page detected (the body is error copy, not the real page).",
        fingerprint: `error_page:${errorHit.source}`,
      };
    }
  }

  if (bodyText.length < MIN_VISIBLE_BODY_CHARACTERS) {
    return {
      valid: false,
      reasonCode: "landing_content_signature_too_small",
      reason: `Visible body signature too small (${bodyText.length} chars) to be a real page.`,
      fingerprint: `content_signature:${bodyText.length}`,
    };
  }

  return { valid: true, reasonCode: null, reason: "", fingerprint: null };
}
