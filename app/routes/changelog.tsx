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
      <PublicDocBlock title="2026-07-20">
        <ul className="f9-doc-list">
          <li>Search results now show real creative thumbnails when the Ad Library returns image or video media.</li>
          <li>Search results go deeper, with sort controls, marketing-angle chips, and variant counts when available.</li>
          <li>Signed-in fresh searches can show a grounded &quot;What to steal&quot; AI summary of the ads above.</li>
          <li>Watchlist detail now includes a Competitor Dossier with Aggression Score and, on paid plans, an AI Counter-Brief.</li>
          <li>The workspace supports dark mode via a theme toggle.</li>
          <li>Press Cmd+K (or Ctrl+K) in the workspace to quick-add a competitor watchlist.</li>
          <li>On paid plans, signed-in users can save a search result to a board from the result card.</li>
          <li>The Competitors list supports bulk pause and resume for selected watchlists.</li>
          <li>Free accounts include one weekly Competitor Watch with an activation scan and weekly email brief.</li>
          <li>Public brand pages are available at /ads/:domain for cached competitor ad snapshots.</li>
          <li>The landing page has a product FAQ, and a new compare page covers checking the Meta Ad Library by hand.</li>
          <li>Customer-facing product copy received a full voice pass for clearer, plainer language.</li>
          <li>Workspace and public pages load faster after loader parallelization and related performance work.</li>
        </ul>
      </PublicDocBlock>

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
