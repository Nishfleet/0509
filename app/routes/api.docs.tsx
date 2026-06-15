import { Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { PublicDocBlock, PublicDocShell } from "~/components/public-doc-shell";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";

const description =
  "Five to Nine API and MCP docs for read-only account-owned exports.";

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
      title="Read account-owned proof from your tools."
      intro="The API is read-only. It exports saved Five to Nine data that already belongs to the authenticated account."
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
          POST JSON-RPC to `/api/mcp` with the same bearer token. The endpoint exposes read-only tools
          for collection, watchlist, and digest exports. It does not support public write actions.
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
          <li>Let an agent read digest exports through MCP without giving it write access.</li>
        </ul>
      </PublicDocBlock>

      <PublicDocBlock title="Limits and non-goals">
        <ul className="f9-doc-list">
          <li>API reads are account-scoped and rate limited.</li>
          <li>Keys are shown once, stored hashed, and can be revoked from Integrations &amp; API.</li>
          <li>Not live yet: public write API, unsupported-channel ingestion, or automated spend/reach/impression benchmarks.</li>
        </ul>
      </PublicDocBlock>
    </PublicDocShell>
  );
}
