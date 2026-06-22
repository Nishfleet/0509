import type { LinksFunction, MetaFunction } from "react-router";

import { PublicDocBlock, PublicDocShell } from "~/components/public-doc-shell";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";

const description =
  "Five to Nine changelog for delivery, billing, and public trust updates.";

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
      intro="Only shipped or explicitly gated changes are listed here. Roadmap claims stay out until they are verified."
    >
      <PublicDocBlock title="2026-06-15">
        <ul className="f9-doc-list">
          <li>Made `0509.io` the primary production domain and kept `.in` as redirect compatibility only.</li>
          <li>Corrected email delivery documentation to match the live provider.</li>
          <li>Added public help, docs, API docs, status, changelog, and trust surfaces.</li>
          <li>Kept WhatsApp unavailable for customers until account-level delivery is enabled.</li>
        </ul>
      </PublicDocBlock>

      <PublicDocBlock title="2026-06-13">
        <ul className="f9-doc-list">
          <li>Hardened billing verification so signed plan and proof-credit grants clean up after checks.</li>
          <li>Kept Slack delivery claims limited until real customer delivery could be verified.</li>
        </ul>
      </PublicDocBlock>
    </PublicDocShell>
  );
}
