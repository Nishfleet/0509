import { Link, useRouteLoaderData } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { PublicDocBlock, PublicDocShell } from "~/components/public-doc-shell";
import {
  AGENT_BLOCKED_CAPABILITIES,
  auditedAgentActionGroups,
} from "~/lib/agent-action-catalog";
import { appLinkTarget } from "~/lib/app-link";
import {
  canonicalLinks,
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
} from "~/lib/seo";
import type { RootLoaderData } from "~/root";
import "../marketing.css";

const description =
  "Five to Nine API docs for read-only evidence access and approved account actions.";

export const links: LinksFunction = () => canonicalLinks("/api/docs");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "API docs | Five to Nine",
    description,
    pathname: "/api/docs",
  });

// BET 6: read-only tools are free + Scout; write/account-mutation tools are
// Agency. This table is documentation copy; the authoritative gate lives in
// app/lib/plan-feature-gate.server.ts.
const READ_ONLY_TOOLS: Array<[string, string]> = [
  ["get_workspace_readiness", "Account setup and readiness state"],
  ["get_change_history", "Evidence-backed change history for a domain"],
  ["get_offer_state_at", "Stored offer state for a domain on a date"],
  ["diff_offer", "Diff two stored offer states for a domain"],
  ["list_suppressed", "Proof-suppressed snapshot rows for a domain"],
  ["get_collection_export", "Read an account-owned collection"],
  ["get_watchlist_export", "Read an account-owned watchlist"],
  ["get_digest_export", "Read an account-owned digest"],
  ["watchlist_runs.list", "List watchlist run history"],
];

const WRITE_TOOLS: Array<[string, string]> = [
  ["retest_meta_source", "Retest saved source access"],
  ["create_watchlist", "Create a competitor watchlist"],
  ["update_watchlist", "Tune a watchlist"],
  ["refresh_watchlist", "Refresh a watchlist"],
  ["pause_watchlist", "Pause a watchlist"],
  ["resume_watchlist", "Resume a watchlist"],
  ["create_collection", "Create a collection"],
  ["add_external_proof", "Save visible external evidence"],
  ["create_share_link", "Create a share link"],
  ["create_report", "Create a report"],
  ["share_report", "Share a report"],
  ["create_counter_move_brief", "Create a counter-move brief"],
  ["upsert_memory", "Save account context"],
  ["list_memory", "Read scoped account memory"],
  ["upsert_client_room", "Save a client room"],
  ["list_client_rooms", "Read client rooms"],
  ["create_support_case", "Open a support case"],
  ["list_support_cases", "Read support case summaries"],
  ["list_delivery_targets", "Read redacted delivery targets"],
  ["update_delivery_settings", "Update delivery policy"],
  ["update_delivery_target", "Update a delivery target"],
  ["list_web_mentions", "Read existing web mention observations"],
];

export default function ApiDocsRoute() {
  const rootData = useRouteLoaderData("root") as RootLoaderData | undefined;

  return (
    <PublicDocShell
      kicker="Developer access"
      title="Use account-owned evidence from your tools."
      intro="Read-only access on Free + Scout. Writes and exports on Starter+. Full agent actions on Agency."
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
          Read-only API and connected-tool access is available on Free and Scout. Create a customer
          API key inside{" "}
          <Link to={appLinkTarget("/app/developer-access", rootData?.session)}>Developer access</Link>.
          Send it as a bearer token:
        </p>
        <pre className="f9-code-block">
          <code>{`Authorization: Bearer f9_live_...`}</code>
        </pre>
        <p>
          Read-only keys work on Free and Scout. Write-enabled keys (approved account actions)
          require the Starter plan or above.
        </p>
      </PublicDocBlock>

      <PublicDocBlock title="Connected tools">
        <p>
          Compatible tools can connect with the same bearer token. Use an active customer API key
          for readiness and read-only evidence. Use a write-enabled key only when the tool should
          run approved account actions.
        </p>
        <p>
          Follow the{" "}
          <Link to="/mcp/setup">one-paste MCP setup</Link> for Claude Desktop, ChatGPT, and pi
          connector snippets.
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
          Read-only tools are available on Free and Scout. Write and account-mutation tools require
          the Agency plan.
        </p>
        <p>
          <strong>Read-only — Free + Scout</strong>
        </p>
        <dl className="proof-trail-list">
          {READ_ONLY_TOOLS.map(([tool, detail]) => (
            <div key={tool}>
              <dt>
                <code>{tool}</code>
              </dt>
              <dd>{detail}</dd>
            </div>
          ))}
        </dl>
        <p>
          <strong>Write and account-mutation — Agency</strong>
        </p>
        <dl className="proof-trail-list">
          {WRITE_TOOLS.map(([tool, detail]) => (
            <div key={tool}>
              <dt>
                <code>{tool}</code>
              </dt>
              <dd>{detail}</dd>
            </div>
          ))}
        </dl>
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
        <p>
          JSON reads are available on Free and Scout. CSV and Slack exports require the Starter plan
          or above.
        </p>
      </PublicDocBlock>

      <PublicDocBlock title="Account actions">
        <p>Approved account actions require the Agency plan and a write-enabled key.</p>
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
          <li>Ask an agent what changed on a competitor domain this month with receipts.</li>
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
