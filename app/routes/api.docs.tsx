import { Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { PublicDocBlock, PublicDocShell } from "~/components/public-doc-shell";
import {
  AGENT_BLOCKED_CAPABILITIES,
  auditedAgentActionGroups,
} from "~/lib/agent-action-catalog";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";

const description =
  "Five to Nine API docs for account-owned exports and account actions.";

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
      intro="The API exports saved Five to Nine data that already belongs to the authenticated account and supports selected account actions."
    >
      <PublicDocBlock title="Authentication">
        <p>
          Create a customer API key inside <Link to="/app/sources">Notifications</Link>.
          Send it as a bearer token:
        </p>
        <pre className="f9-code-block">
          <code>{`Authorization: Bearer f9_live_...`}</code>
        </pre>
      </PublicDocBlock>

      <PublicDocBlock title="MCP for connected tools">
        <p>
          Tools that support MCP can connect with the same bearer token. Use an active customer API key for readiness
          and exports. Use a write-enabled key only when the tool should update supported account resources.
        </p>
        <pre className="f9-code-block">
          <code>{`POST /api/mcp
Authorization: Bearer f9_live_...

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {}
}`}</code>
        </pre>
      </PublicDocBlock>

      <PublicDocBlock title="REST endpoints">
        <dl className="proof-trail-list">
          <div>
            <dt>Account readiness</dt>
            <dd>GET /api/v1/workspace-readiness</dd>
          </div>
          <div>
            <dt>Account actions</dt>
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
            <dd>GET /api/v1/digests/&lbrace;digestId&rbrace;?format=json</dd>
          </div>
        </dl>
        <p>Supported formats are JSON and CSV where the resource supports them.</p>
      </PublicDocBlock>

      <PublicDocBlock title="Account actions">
        <dl className="proof-trail-list">
          {auditedAgentActionGroups().map((group) => (
            <div key={group.id}>
              <dt>{group.label}</dt>
              <dd>{group.detail} {group.credentialRequirement}</dd>
            </div>
          ))}
        </dl>
      </PublicDocBlock>

      <PublicDocBlock title="Recipes">
        <ul className="f9-doc-list">
          <li>Export a watchlist as CSV before a weekly sales meeting.</li>
          <li>Pull a board as JSON into a team research note.</li>
          <li>Create a counter-move brief and save account context for future reports.</li>
        </ul>
      </PublicDocBlock>

      <PublicDocBlock title="Limits and non-goals">
        <ul className="f9-doc-list">
          <li>API reads are account-scoped and rate limited.</li>
          <li>Approved account actions are limited to safe operations and store an action log.</li>
          <li>Keys are shown once, stored hashed, and can be revoked from Notifications.</li>
          <li>Restricted actions still require signed-in owner review: {AGENT_BLOCKED_CAPABILITIES.join(", ")}.</li>
          <li>Not live yet: X/YouTube listening or broad social listening beyond existing proof-backed observations.</li>
        </ul>
      </PublicDocBlock>
    </PublicDocShell>
  );
}
