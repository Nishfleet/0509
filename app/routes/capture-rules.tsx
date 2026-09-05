import type { LinksFunction, MetaFunction } from "react-router";

import { PublicDocBlock, PublicDocShell } from "~/components/public-doc-shell";
import {
  CAPTURE_BUDGET_SKIP_PUBLIC_RULE,
  CAPTURE_RULES_PUBLIC_PATH,
  CAPTURE_VALIDITY_PUBLIC_RULES,
} from "~/lib/capture-validity-public-rules";
import {
  canonicalLinks,
  faqPageJsonLd,
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
  type FaqJsonLdEntry,
} from "~/lib/seo";

// Reason codes rendered below via CAPTURE_VALIDITY_PUBLIC_RULES (the source of
// truth lives in capture-validity-public-rules.ts, which maps each to a
// gate kind): landing_error_page, landing_challenge_page,
// landing_cookie_wall, landing_partial_spa,
// landing_content_signature_too_small.
const description =
  "The landing-page captures Five to Nine refuses to turn into alerts: error pages, bot walls, cookie walls, partial loads, and churn that is not a real change.";

// FAQ entries for the /capture-rules FAQPage JSON-LD. One entry
// per visible block on the page: the guarantee, each capture-validity rule,
// and the "What still alerts" section. The rule entries are derived from
// CAPTURE_VALIDITY_PUBLIC_RULES — the same source the route renders — so the
// structured data cannot drift from the visible copy or from the gate union.
// No fabricated Q/A: every question is a verbatim block title and every answer
// restates the visible paragraphs.
const captureRulesFaqEntries: ReadonlyArray<FaqJsonLdEntry> = [
  {
    question: "The guarantee",
    answer:
      "If we send an alert, the page really changed. A failed capture is recorded as failed and never becomes an alert. A real price, offer, or CTA change on a valid page still produces one event, with a screenshot that matches the extract.",
  },
  ...CAPTURE_VALIDITY_PUBLIC_RULES.map((rule) => ({
    question: rule.title,
    answer: `We refuse: ${rule.refused} Why: ${rule.why}`,
  })),
  {
    question: "What still alerts",
    answer:
      "A genuine price, offer, or CTA edit on a real landing page, corroborated by the screenshot, still alerts. Headline and form changes also alert from signals in the captured page a missing screenshot cannot fake (the document title and form structure); no screenshot needed.",
  },
];

export { captureRulesFaqEntries };

export const links: LinksFunction = () => canonicalLinks(CAPTURE_RULES_PUBLIC_PATH);

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "What we refuse to alert on | Five to Nine",
    description,
    pathname: CAPTURE_RULES_PUBLIC_PATH,
  });

export default function CaptureRulesRoute() {
  // Invariant: every CaptureValidityReasonCode must have a public rule on this
  // page. A new reason code without a public line fails in
  // tests/capture-rules-page.test.ts (lock test). Reason codes:
  // landing_error_page, landing_challenge_page, landing_cookie_wall,
  // landing_partial_spa, landing_content_signature_too_small.
  return (
    <PublicDocShell
      kicker="Proof"
      title="What we refuse to alert on."
      intro="If we send an alert, the page really changed. These are the captures we refuse to turn into alerts — the same rules the capture-validity gate already runs."
    >
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: "What we refuse to alert on | Five to Nine",
            description,
            pathname: CAPTURE_RULES_PUBLIC_PATH,
          }),
        )}
      />
      <script {...jsonLdScriptProps(faqPageJsonLd(captureRulesFaqEntries))} />
      <PublicDocBlock title="The guarantee">
        <p>
          A failed capture is recorded as failed. It is never an alert. A real price, offer, or CTA
          change on a valid page still produces one event, with a screenshot that matches the extract.
        </p>
      </PublicDocBlock>

      {CAPTURE_VALIDITY_PUBLIC_RULES.map((rule) => (
        <PublicDocBlock key={rule.id} id={rule.id} title={rule.title}>
          <p>
            <strong>We refuse:</strong> {rule.refused}
          </p>
          <p>
            <strong>Why:</strong> {rule.why}
          </p>
        </PublicDocBlock>
      ))}

      <PublicDocBlock
        id={CAPTURE_BUDGET_SKIP_PUBLIC_RULE.id}
        title={CAPTURE_BUDGET_SKIP_PUBLIC_RULE.title}
      >
        <p>
          <strong>We skip:</strong> {CAPTURE_BUDGET_SKIP_PUBLIC_RULE.refused}
        </p>
        <p>
          <strong>Why:</strong> {CAPTURE_BUDGET_SKIP_PUBLIC_RULE.why}
        </p>
      </PublicDocBlock>

      <PublicDocBlock title="What still alerts">
        <p>
          A genuine price, offer, or CTA edit on a real landing page, corroborated by the screenshot, still
          alerts. Headline and form changes also alert, from signals in the captured page a missing screenshot
          cannot fake (the document title and form structure); no screenshot needed.
        </p>
      </PublicDocBlock>
    </PublicDocShell>
  );
}
