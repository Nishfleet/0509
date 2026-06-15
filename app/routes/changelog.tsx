import type { LinksFunction, MetaFunction } from "react-router";

import { PublicDocBlock, PublicDocShell } from "~/components/public-doc-shell";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";

const description =
  "Five to Nine changelog for launch-readiness, delivery, billing, and public trust updates.";

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
          <li>Corrected active email-provider truth to Cloudflare Email Service `send_email`.</li>
          <li>Added public help, docs, API docs, status, changelog, and trust surfaces.</li>
          <li>Kept WhatsApp out of launch scope until provider and delivered proof exist.</li>
        </ul>
      </PublicDocBlock>

      <PublicDocBlock title="2026-06-13">
        <ul className="f9-doc-list">
          <li>Hardened the Dodo billing canary so signed plan and proof-credit grants clean up after verification.</li>
          <li>Kept Slack delivery proof as an explicit launch gate instead of overclaiming broad self-serve readiness.</li>
        </ul>
      </PublicDocBlock>
    </PublicDocShell>
  );
}
