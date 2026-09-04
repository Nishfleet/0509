import { Link, useRouteLoaderData } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { PublicDocBlock, PublicDocShell } from "~/components/public-doc-shell";
import {
  AGENT_BLOCKED_CAPABILITIES,
  auditedAgentActionGroups,
  READ_ONLY_API_KEY_REQUIREMENT,
  WRITE_ENABLED_API_KEY_REQUIREMENT,
} from "~/lib/agent-action-catalog";
import { MCP_TOOLS } from "~/routes/api.mcp";
import {
  customerApiToolPlanRequirement,
  isMcpWriteToolName,
} from "~/lib/plan-feature-gate.server";
import { appLinkTarget } from "~/lib/app-link";
import {
  canonicalLinks,
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
} from "~/lib/seo";
import type { RootLoaderData } from "~/root";

const description =
  "Five to Nine API docs for read-only access on Free and Scout, exports on Starter, and full agent actions on Agency.";

export const links: LinksFunction = () => canonicalLinks("/api/docs");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "API docs | Five to Nine",
    description,
    pathname: "/api/docs",
  });

export default function ApiDocsRoute() {
  const rootData = useRouteLoaderData("root") as RootLoaderData | undefined;

  return (
    <PublicDocShell
      kicker="Developer access"
      title="Use account-owned evidence from your tools."
      intro="The API reads saved Five to Nine data that already belongs to the authenticated account. Read-only access is on Free and Scout, writes and exports on Starter+, and full agent actions on Agency."
    >
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: "API docs | Five to Nine",
            description,
            pathname: "/api/docs",
          }),
        )}
      />
      <PublicDocBlock title="Authentication">
        <p>
          Read-only access is on Free and Scout. Writes and exports are on Starter+.
          Full agent actions are on Agency. Create a customer API key inside{" "}
          <Link to={appLinkTarget("/app/developer-access", rootData?.session)}>Developer access</Link>{" "}
          and send it as a bearer token:
        </p>
        <pre className="f9-code-block">
          <code>{`Authorization: Bearer f9_live_...`}</code>
        </pre>
        <p>
          {READ_ONLY_API_KEY_REQUIREMENT}
        </p>
      </PublicDocBlock>

      <PublicDocBlock title="Connected tools">
        <p>
          Compatible tools connect with the same bearer token. Read-only tools work with
          any active customer API key, including Free and Scout. Use a write-enabled key
          only when the tool should run approved account actions ({WRITE_ENABLED_API_KEY_REQUIREMENT}).
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

      <PublicDocBlock title="Tool tiers">
        <p>
          Read-only tools are available on Free and Scout with any active key. Agent
          action tools need a write-enabled key and the Agency plan.
        </p>
        <table className="f9-api-tier-table">
          <thead>
            <tr>
              <th scope="col">Tool</th>
              <th scope="col">Tier</th>
              <th scope="col">Key</th>
            </tr>
          </thead>
          <tbody>
            {MCP_TOOLS.map((tool) => (
              <tr key={tool.name}>
                <td>
                  <code>{tool.name}</code>
                </td>
                <td>{customerApiToolPlanRequirement(tool.name)}</td>
                <td>
                  {isMcpWriteToolName(tool.name)
                    ? "Write-enabled"
                    : "Read-only (any active key)"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
						<dd>{"GET /api/v1/collections/{collectionId}?format=json"}</dd>
          </div>
          <div>
            <dt>Watchlists</dt>
						<dd>{"GET /api/v1/watchlists/{watchlistId}?format=csv"}</dd>
          </div>
          <div>
            <dt>Digests</dt>
						<dd>{"GET /api/v1/digests/{digestId}?format=json"}</dd>
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
          <li>Pull a collection as JSON into a team research note.</li>
          <li>Create a counter-move brief and save account context for future reports.</li>
        </ul>
      </PublicDocBlock>

      <PublicDocBlock title="Limits and non-goals">
        <ul className="f9-doc-list">
          <li>API reads are account-scoped and rate limited.</li>
          <li>Approved account actions are limited to documented safe operations and store an action log.</li>
          <li>Keys are shown once, stored hashed, and can be revoked from Developer access.</li>
          <li>Restricted actions still require signed-in owner review: {AGENT_BLOCKED_CAPABILITIES.join(", ")}.</li>
          <li>Not live yet: automated X, Reddit, LinkedIn, YouTube, TikTok, Google, or Pinterest ingestion.</li>
        </ul>
      </PublicDocBlock>
    </PublicDocShell>
  );
}
