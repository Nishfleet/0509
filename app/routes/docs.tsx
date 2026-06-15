import { Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { PublicDocBlock, PublicDocShell } from "~/components/public-doc-shell";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";

const description =
  "Five to Nine product docs for setup, launch posture, delivery, billing, integrations, and safety.";

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
      title="Five to Nine product docs."
      intro="Current behavior only. Roadmap channels and trust claims stay marked until they are proven."
    >
      <PublicDocBlock title="Day 0-7 activation checklist">
        <ol className="f9-numbered-guide">
          <li>Day 0: paste a competitor website and confirm public live search returns labeled results.</li>
          <li>Day 0: create the first account watchlist from search or onboarding.</li>
          <li>Day 1: refresh the watchlist and confirm the first proof capture exists.</li>
          <li>Day 1-2: review the first digest or quiet-check trail.</li>
          <li>Day 2: connect Slack from Integrations &amp; API if the team wants channel delivery.</li>
          <li>Day 3: invite teammates on Agency, or keep the workspace owner-only on smaller plans.</li>
          <li>Day 7: review Plan &amp; billing for evidence-check usage, renewal state, and capacity.</li>
        </ol>
      </PublicDocBlock>

      <PublicDocBlock title="What is live today">
        <ul className="f9-doc-list">
          <li>Public read-only live search and a sample proof loop.</li>
          <li>Authenticated watchlists, boards, digests, reports, share links, exports, API keys, and MCP exports.</li>
          <li>Dodo-backed pricing, checkout, signed webhook grants, proof-credit packs, and billing portal redirect.</li>
          <li>Email delivery through Cloudflare Email Service and self-serve Slack incoming webhooks.</li>
          <li>Security headers, rate limits, plan caps, proof usage warnings, and operator health views.</li>
        </ul>
      </PublicDocBlock>

      <PublicDocBlock title="What is not launch-scoped">
        <ul className="f9-doc-list">
          <li>Customer WhatsApp delivery until Meta provider setup, templates, opt-in, webhook reconciliation, and delivery proof are verified.</li>
          <li>Automated TikTok, Google, YouTube, LinkedIn, Pinterest ingestion, or automated spend/reach/impression benchmarks.</li>
          <li>Public write APIs.</li>
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
