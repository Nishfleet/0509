import type { LinksFunction, MetaFunction } from "react-router";

import { PublicDocBlock, PublicDocShell } from "~/components/public-doc-shell";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";

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
