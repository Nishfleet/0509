// Buyer-surface "no phantom changes" guarantee page (issue #2026).
//
// /capture-rules is the engineer-facing, gate-mapped rule list (issue 970).
// This page is the buyer-facing statement of the same guarantee, framed the
// way a prospect evaluating a plan reads it: "if we send it, the page really
// changed". It renders the SAME CAPTURE_VALIDITY_PUBLIC_RULES source the
// capture-rules page renders (so the two cannot drift) plus the two
// offer-timeline suppressions that live outside the capture-validity reason
// codes: geo-variance and the takedown/restore baseline rule — both shipped
// in issue #1996 and visible as suppressed states in run history.
import type { LinksFunction, MetaFunction } from "react-router";
import { Link } from "react-router";

import { Breadcrumbs } from "~/components/breadcrumbs";
import { PublicDocBlock, PublicDocShell } from "~/components/public-doc-shell";
import { CAPTURE_VALIDITY_PUBLIC_RULES } from "~/lib/capture-validity-public-rules";
import {
  canonicalLinks,
  publicSeoMeta,
  webPageJsonLd,
  jsonLdScriptProps,
} from "~/lib/seo";
import "../marketing.css";

export const NO_PHANTOM_CHANGES_PUBLIC_PATH = "/no-phantom-changes";

const title = "No phantom changes — if we send it, the page really changed";
const description =
  "If we send it, the page really changed. Error pages, bot challenges, cookie walls, partial loads, geo-variance and timestamp churn are never alerts — see the full rule set.";

export const links: LinksFunction = () => canonicalLinks(NO_PHANTOM_CHANGES_PUBLIC_PATH);

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: `${title} | Five to Nine`,
    description,
    pathname: NO_PHANTOM_CHANGES_PUBLIC_PATH,
  });

export default function NoPhantomChangesRoute() {
  return (
    <PublicDocShell
      kicker="Guarantee"
      title="No phantom changes."
      intro="If we send it, the page really changed. A capture that fails validity is never an alert — it is recorded as failed or suppressed, with its reason, in run history."
    >
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: title,
            description,
            pathname: NO_PHANTOM_CHANGES_PUBLIC_PATH,
          }),
        )}
      />
      <Breadcrumbs
        items={[
          { name: "Home", pathname: "/" },
          { name: "No phantom changes", pathname: NO_PHANTOM_CHANGES_PUBLIC_PATH },
        ]}
      />
      <PublicDocBlock title="The guarantee">
        <p>
          If we send an alert, the page really changed. A failed or suppressed capture is recorded as
          failed in run history and never becomes an alert. A real price, offer, or CTA change on a
          valid page still produces one event, with a screenshot that matches the extract.
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

      <PublicDocBlock id="geo-variance" title="Geo-variance">
        <p>
          <strong>We suppress:</strong> a capture of a different country or locale storefront than the
          previous one — the same page served from another region, in another language or currency.
        </p>
        <p>
          <strong>Why:</strong> the offer did not change for your buyer; the region did. The offer
          timeline records the state as suppressed with the reason "geo locale change" so you can see
          exactly what was compared — never as a change.
        </p>
      </PublicDocBlock>

      <PublicDocBlock id="takedown-restore-baseline" title="Site down, then back">
        <p>
          <strong>We refuse:</strong> treating a restored site as a change. When a site returns after
          downtime or a takedown, we compare against the last successful capture, not against the
          error page.
        </p>
        <p>
          <strong>Why:</strong> "the site came back" is not an offer change. A failed capture never
          becomes the baseline, so restore is not an alert.
        </p>
      </PublicDocBlock>

      <PublicDocBlock title="Where failed and suppressed captures show up">
        <p>
          Every refused or suppressed capture is visible in run history with its reason — nothing is
          silently dropped. The full, gate-by-gate rule list lives on{" "}
          <Link to="/capture-rules">what we refuse to alert on</Link>; the buyer-side trust summary
          lives on <Link to="/trust">Trust</Link>.
        </p>
      </PublicDocBlock>
    </PublicDocShell>
  );
}
