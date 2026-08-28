/**
 * Public copy for the capture-validity rules page (`/proof`).
 *
 * Every entry maps to a gate shipped in BET 4 Part 1 (issue #953): either a
 * `assessCaptureValidity` reason code, an extractor suppression that produces
 * zero events, or the screenshot corroboration cross-check. The page is the
 * checkable public list; this module is the single source so the route and
 * the tests cannot drift.
 */
export type CaptureValidityPublicGate =
  | {
      kind: "reason_code";
      code:
        | "landing_error_page"
        | "landing_challenge_page"
        | "landing_cookie_wall"
        | "landing_partial_spa"
        | "landing_content_signature_too_small";
    }
  | { kind: "extractor_suppression"; code: "churn_stable" | "ad_slot_strip" }
  | { kind: "corroboration"; code: "screenshot_corroboration" }
  | { kind: "classifier"; code: "maintenance_window" };

export interface CaptureValidityPublicRule {
  id: string;
  title: string;
  refused: string;
  why: string;
  gate: CaptureValidityPublicGate;
  /** Label or phrase that appears in the #953 fixture suite, used to prove the mapping. */
  issue953Anchor: string;
}

export const CAPTURE_VALIDITY_PUBLIC_RULES: readonly CaptureValidityPublicRule[] = [
  {
    id: "error-pages",
    title: "Error pages",
    refused:
      "HTTP 4xx and 5xx responses, and 200 pages whose visible body is generic error or maintenance copy.",
    why: "The capture is an error page, not the competitor’s offer. Diffing it against the last real page would look like a rewrite.",
    gate: { kind: "reason_code", code: "landing_error_page" },
    issue953Anchor: "500 error page",
  },
  {
    id: "challenge-pages",
    title: "Challenge pages",
    refused:
      "Anti-bot interstitials — Cloudflare “Just a moment”, Turnstile, and the same class of verification walls.",
    why: "The capture saw a verification wall, not the real page. A price or CTA pulled from that wall is a phantom change.",
    gate: { kind: "reason_code", code: "landing_challenge_page" },
    issue953Anchor: "Cloudflare challenge",
  },
  {
    id: "cookie-consent-walls",
    title: "Cookie and consent walls",
    refused:
      "Cookie banners that gate the real content: gating copy, or a banner with too little visible body to be the actual page.",
    why: "Signals would come from the banner, not the landing page. A non-gating cookie notice on a full page still counts as a real page.",
    gate: { kind: "reason_code", code: "landing_cookie_wall" },
    issue953Anchor: "cookie / consent wall",
  },
  {
    id: "partial-loads",
    title: "Partial loads",
    refused:
      "Empty app shells, “enable JavaScript” notices, and pages with too little visible body to be a real landing page.",
    why: "A half-loaded app is not the page. Alerting on the shell versus the real page is noise.",
    gate: { kind: "reason_code", code: "landing_partial_spa" },
    issue953Anchor: "partial SPA shell",
  },
  {
    id: "too-thin-content",
    title: "Too-thin content",
    refused:
      "Pages whose visible body is too small to be a real landing page — the body is too thin to tell a real thin page from a shell or a bot wall.",
    why:
      "Below the gate\u2019s minimum body signature, a capture cannot be proven real. A challenge page or SPA shell has only tens of characters of boilerplate; a real landing page has hundreds.",
    gate: { kind: "reason_code", code: "landing_content_signature_too_small" },
    issue953Anchor: "partial SPA shell",
  },
  {
    id: "takedown-restore",
    title: "Site down, then back",
    refused:
      "Maintenance and takedown pages. When the site returns, we still compare against the last successful capture, not against the error page.",
    why: "“The site came back” is not an offer change. A failed capture never becomes the baseline, so restore is not an alert.",
    gate: { kind: "reason_code", code: "landing_error_page" },
    issue953Anchor: "site down (maintenance)",
  },
  {
    id: "timestamp-only",
    title: "Timestamp-only edits",
    refused: "A page that differs only by an embedded timestamp or generated-at stamp.",
    why: "The offer did not change. The extractor ignores churn-only deltas, so no event fires.",
    gate: { kind: "extractor_suppression", code: "churn_stable" },
    issue953Anchor: "timestamp-only edit",
  },
  {
    id: "rotating-banners",
    title: "Rotating banners",
    refused:
      "Third-party ad-slot creatives that rotate while the rest of the page stays the same.",
    why: "An ad network swapping a banner is not a competitor offer change. Ad-slot regions are stripped before the diff.",
    gate: { kind: "extractor_suppression", code: "ad_slot_strip" },
    issue953Anchor: "rotating banner",
  },
  {
    id: "scheduled-maintenance-window",
    title: "Scheduled maintenance window",
    refused:
      "Captures taken during a scheduled maintenance window when the page state is intentionally unstable.",
    why: "We suppress the diff until the window passes so a transient maintenance state does not become a phantom change.",
    gate: { kind: "classifier", code: "maintenance_window" },
    issue953Anchor: "scheduled maintenance window",
  },
  {
    id: "screenshot-corroboration",
    title: "Extract without a matching screenshot",
    refused:
      "A price or CTA change found in the HTML extract that the screenshot does not corroborate.",
    why: "HTML extraction alone can invent a change a visitor would not see. No screenshot match, no alert.",
    gate: { kind: "corroboration", code: "screenshot_corroboration" },
    issue953Anchor: "screenshot corroboration",
  },
];

export const CAPTURE_VALIDITY_PUBLIC_PATH = "/proof";
/**
 * Public alias path for the capture-validity rules page. Shipped alongside
 * `/proof` (issue #1264) so a buyer searching the category term finds the
 * checkable rule set at the URL the BET 4 contract names.
 */
export const CAPTURE_RULES_PUBLIC_PATH = "/capture-rules";
