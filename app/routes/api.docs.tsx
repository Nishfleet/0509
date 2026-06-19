import { Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { PublicDocBlock, PublicDocShell } from "~/components/public-doc-shell";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";

const description =
  "Five to Nine API and MCP docs for account-owned exports and audited workspace actions.";

export const links: LinksFunction = () => canonicalLinks("/api/docs");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "API docs | Five to Nine",
    description,
    pathname: "/api/docs",
  });

export default function ApiDocsRoute() {
  return (
    <PublicDocShell
      kicker="API docs"
      title="Use account-owned proof from your tools."
      intro="The API exports saved Five to Nine data that already belongs to the authenticated account and supports narrow audited workspace actions."
    >
      <PublicDocBlock title="Authentication">
        <p>
          Create a customer API key inside <Link to="/app/sources">Integrations &amp; API</Link>.
          Send it as a bearer token:
        </p>
        <pre className="f9-code-block">
          <code>{`Authorization: Bearer f9_live_...`}</code>
        </pre>
      </PublicDocBlock>

      <PublicDocBlock title="REST endpoints">
        <dl className="proof-trail-list">
          <div>
            <dt>Workspace readiness</dt>
            <dd>GET /api/v1/workspace-readiness</dd>
          </div>
          <div>
            <dt>Audited actions</dt>
            <dd>POST /api/v1/actions</dd>
          </div>
          <div>
            <dt>Collections</dt>
            <dd>GET /api/v1/collections/&lbrace;collectionId&rbrace;?format=json</dd>
          </div>
          <div>
            <dt>Watchlists</dt>
            <dd>GET /api/v1/watchlists/&lbrace;watchlistId&rbrace;?format=csv</dd>
          </div>
          <div>
            <dt>Digests</dt>
            <dd>GET /api/v1/digests/&lbrace;digestId&rbrace;?format=slack</dd>
          </div>
        </dl>
        <p>Supported formats are JSON, CSV, and Slack-ready markdown where the resource supports them.</p>
      </PublicDocBlock>

      <PublicDocBlock title="MCP endpoint">
        <p>
          POST JSON-RPC to `/api/mcp` with the same bearer token. The endpoint exposes readiness/export
          tools plus audited actions for watchlists, manual proof links, share links, reports,
          counter-move briefs, account memory, and client rooms.
        </p>
        <pre className="f9-code-block">
          <code>{`{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {}
}`}</code>
        </pre>
      </PublicDocBlock>

      <PublicDocBlock title="Recipes">
        <ul className="f9-doc-list">
          <li>Export a watchlist as Slack markdown before a weekly sales meeting.</li>
          <li>Pull a board as JSON into an internal research note.</li>
          <li>Let an agent inspect readiness, create a counter-move brief, and save account memory through MCP.</li>
        </ul>
      </PublicDocBlock>

      <PublicDocBlock title="Limits and non-goals">
        <ul className="f9-doc-list">
          <li>API reads are account-scoped and rate limited.</li>
          <li>Audited actions are limited to safe workspace operations and store an action log.</li>
          <li>Keys are shown once, stored hashed, and can be revoked from Integrations &amp; API.</li>
          <li>Not live yet: broad public write APIs, billing/team/delivery-send actions, unsupported-channel ingestion, or automated spend/reach/impression benchmarks.</li>
        </ul>
      </PublicDocBlock>
    </PublicDocShell>
  );
}
