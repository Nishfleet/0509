import { Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { PublicDocBlock, PublicDocShell } from "~/components/public-doc-shell";
import {
  CAPTURE_VALIDITY_PUBLIC_PATH,
  CAPTURE_VALIDITY_PUBLIC_RULES,
} from "~/lib/capture-validity-public-rules";
import {
  canonicalLinks,
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
} from "~/lib/seo";

const description =
  "The landing-page captures Five to Nine refuses to turn into alerts: error pages, bot walls, cookie walls, partial loads, and churn that is not a real change.";

export const links: LinksFunction = () => canonicalLinks(CAPTURE_VALIDITY_PUBLIC_PATH);

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "What we refuse to alert on | Five to Nine",
    description,
    pathname: CAPTURE_VALIDITY_PUBLIC_PATH,
  });

export default function ProofRulesRoute() {
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
            pathname: CAPTURE_VALIDITY_PUBLIC_PATH,
          }),
        )}
      />
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

      <PublicDocBlock title="What still alerts">
        <p>
          A genuine price, offer, or CTA edit on a real landing page, corroborated by the screenshot.
          That is the only path from a capture to an event.
        </p>
        <p>
          See the <Link to="/competitor-monitoring">competitor monitoring methodology</Link> for how
          briefs are built from those events.
        </p>
      </PublicDocBlock>
    </PublicDocShell>
  );
}
