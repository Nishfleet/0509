import { Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { PublicDocBlock, PublicDocShell } from "~/components/public-doc-shell";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";

const description =
  "Five to Nine product docs for setup, delivery, billing, integrations, and safety.";

export const links: LinksFunction = () => canonicalLinks("/docs");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Docs | Five to Nine",
    description,
    pathname: "/docs",
  });

export default function DocsRoute() {
  return (
    <PublicDocShell
      kicker="Docs"
      title="Five to Nine docs."
      intro="Short setup notes for getting from one competitor website to saved tracking and useful evidence."
    >
      <PublicDocBlock title="Start with one competitor">
        <ol className="f9-numbered-guide">
          <li>Paste a competitor website into Search.</li>
          <li>Save the competitor when the results are useful.</li>
          <li>Open the watchlist to review ads, page evidence, and changes over time.</li>
          <li>Save useful examples to a collection or share a report with the team.</li>
          <li>Turn on email delivery when the team wants digests in the inbox.</li>
        </ol>
      </PublicDocBlock>

      <PublicDocBlock title="Available today">
        <ul className="f9-doc-list">
          <li>Public competitor ad search from a website.</li>
          <li>Saved watchlists, collections, digests, reports, share links, and exports.</li>
          <li>Checkout, receipts, proof-credit packs, and billing support.</li>
          <li>Email delivery for digests and high-priority change alerts.</li>
          <li>Rate limits, plan caps, evidence-usage warnings, and service status.</li>
        </ul>
      </PublicDocBlock>

      <PublicDocBlock title="Limited today">
        <ul className="f9-doc-list">
          <li>TikTok, Google, YouTube, LinkedIn, and Pinterest ingestion are not included yet.</li>
          <li>Spend, reach, and impression benchmarks are not included yet.</li>
          <li>SOC 2, HIPAA, GDPR compliance, zero-retention, or no-training guarantees.</li>
        </ul>
      </PublicDocBlock>

      <PublicDocBlock title="Key docs">
        <div className="f9-doc-link-grid">
          <Link to="/help">Help</Link>
          <Link to="/api/docs">API docs</Link>
          <Link to="/status">Status</Link>
          <Link to="/changelog">Changelog</Link>
          <Link to="/trust">Trust and security</Link>
          <Link to="/privacy">Privacy</Link>
        </div>
      </PublicDocBlock>
    </PublicDocShell>
  );
}
