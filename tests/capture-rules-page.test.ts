import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  CAPTURE_VALIDITY_REASON_CODES,
  type CaptureValidityReasonCode,
} from "~/lib/capture-validity.server";
import {
  CAPTURE_RULES_PUBLIC_PATH,
  CAPTURE_VALIDITY_PUBLIC_RULES,
  SCREENSHOT_CORROBORATION_REQUIRED_EVENT_TYPES,
} from "~/lib/capture-validity-public-rules";
import { SITEMAP_PATHS } from "~/lib/seo";

const captureRulesHitsInSitemap = [...SITEMAP_PATHS].filter(
  (path) => path === "/capture-rules",
);

/**
 * Lock test for issue #1264: the /capture-rules page must list, in plain
 * language, each current CaptureValidityReasonCode so a new reason code
 * without a public line fails CI. Reads the union from
 * capture-validity.server.ts (the source of truth) and the public rules from
 * capture-validity-public-rules.ts (which the /capture-rules route renders),
 * then asserts every reason code is mapped and the route module renders the
 * rules. A mocked unit that never imports the union does not count.
 */
describe("capture-rules page lock (#1264)", () => {
  it("is registered at /capture-rules and in the sitemap", () => {
    const routeSource = readFileSync("app/routes.ts", "utf8");
    expect(routeSource).toContain(
      'route("capture-rules", "routes/capture-rules.tsx")',
    );
    expect(SITEMAP_PATHS).toContain("/capture-rules");
    expect(CAPTURE_RULES_PUBLIC_PATH).toBe("/capture-rules");
  });

  it("renders every CaptureValidityReasonCode via the public rules", () => {
    const reasonCodes: readonly CaptureValidityReasonCode[] =
      CAPTURE_VALIDITY_REASON_CODES;
    expect(reasonCodes.length).toBe(5);

    const mappedReasonCodes = new Set(
      CAPTURE_VALIDITY_PUBLIC_RULES.filter(
        (rule) => rule.gate.kind === "reason_code",
      ).map((rule) => (rule.gate as { code: string }).code),
    );

    for (const code of reasonCodes) {
      expect(
        mappedReasonCodes,
        `reason code ${code} must have a public rule on /capture-rules`,
      ).toContain(code);
    }
  });

  it("renders each public rule via the /capture-rules route module", () => {
    const routeSource = readFileSync("app/routes/capture-rules.tsx", "utf8");
    const rulesSource = readFileSync(
      "app/lib/capture-validity-public-rules.ts",
      "utf8",
    );

    // The route must import and render the public rules (not a hand-written
    // copy that can drift from the gate union).
    expect(routeSource).toContain("CAPTURE_VALIDITY_PUBLIC_RULES");
    expect(routeSource).toContain(".map((rule)");

    // Each rule's title must appear in the data module the route renders.
    for (const rule of CAPTURE_VALIDITY_PUBLIC_RULES) {
      expect(
        rulesSource,
        `rule ${rule.id} title must be in the public rules module`,
      ).toContain(rule.title);
    }
  });

  it("is linked from /trust and /compare/visualping", () => {
    const trustSource = readFileSync("app/routes/trust.tsx", "utf8");
    const compareSource = readFileSync(
      "app/routes/compare.visualping.tsx",
      "utf8",
    );

    expect(trustSource).toContain("/capture-rules");
    expect(compareSource).toContain("/capture-rules");
  });

  it("has exactly one canonical capture-rules entry in the sitemap and a 301 from /proof (#1432)", () => {
    const redirectSource = readFileSync("app/routes/proof.tsx", "utf8");

    expect(captureRulesHitsInSitemap).toEqual(["/capture-rules"]);
    expect(redirectSource).toContain("redirect(");
    expect(redirectSource).toContain("301");
    expect(redirectSource).toContain("/capture-rules");
  });

  it("pins the screenshot-corroboration scope so the page cannot drift from the code (#1516)", () => {
    // The evaluator must consume the same list this module exports: a future
    // change to `requiresCorroboration` must keep the /capture-rules copy true or
    // this test goes red (prevention mechanism).
    const evaluatorSource = readFileSync(
      "app/lib/watch-event-evaluator.server.ts",
      "utf8",
    );
    expect(evaluatorSource).toContain(
      "SCREENSHOT_CORROBORATION_REQUIRED_EVENT_TYPES",
    );
    // The gate must read the constant, not a hand-rolled list. If a future change
    // re-hardcodes the offer/CTA scope (and drifts from the shared constant),
    // this regex fails closed and forces the public-copy review.
    expect(evaluatorSource).toMatch(
      /requiresCorroboration[\s\S]{0,200}SCREENSHOT_CORROBORATION_REQUIRED_EVENT_TYPES/,
    );

    // The shared scope is price/offer/CTA. Headline and form changes are exempt
    // and must stay named in the public copy, with why they are structurally safe.
    expect(SCREENSHOT_CORROBORATION_REQUIRED_EVENT_TYPES).toEqual([
      "landing_page_offer_changed",
      "landing_page_cta_changed",
    ]);

    const corroborationRule = CAPTURE_VALIDITY_PUBLIC_RULES.find(
      (rule) => rule.gate.kind === "corroboration",
    )!;
    expect(corroborationRule.refused).toMatch(/price, offer, or CTA/);
    expect(corroborationRule.why.toLowerCase()).toMatch(/headline/);
    expect(corroborationRule.why.toLowerCase()).toMatch(/form/);

    // The /capture-rules route's "What still alerts" block must name the
    // exempt event types in plain language so a buyer can verify the rule from
    // the page itself, not by reading code.
    const captureRulesRoute = readFileSync(
      "app/routes/capture-rules.tsx",
      "utf8",
    );
    expect(captureRulesRoute).toMatch(/What still alerts/);
    expect(captureRulesRoute).toMatch(/Headline/);
    expect(captureRulesRoute).toMatch(/form/);

    // /trust must not repeat the blanket "every alert is backed by a screenshot"
    // claim. The corrected sentence stores page text and source link always; a
    // screenshot only when the capture includes one.
    const trustRoute = readFileSync("app/routes/trust.tsx", "utf8");
    expect(trustRoute).not.toMatch(/Alerts are backed by captured page text, source links, and screenshots/);
    expect(trustRoute).toMatch(/screenshot joins the proof when the[\s\n]+capture includes one/);
  });
});
