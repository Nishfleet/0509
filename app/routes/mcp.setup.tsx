import { Link, useRouteLoaderData } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { McpConnectionTest } from "~/components/mcp-connection-test";
import { PublicDocBlock, PublicDocShell } from "~/components/public-doc-shell";
import { appLinkTarget } from "~/lib/app-link";
import {
  canonicalLinks,
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
} from "~/lib/seo";
import type { RootLoaderData } from "~/root";

const description =
  "One-paste MCP setup for Claude Desktop, ChatGPT, and pi — connect Five to Nine as an agent tool with a customer API key.";

export const links: LinksFunction = () => canonicalLinks("/mcp/setup");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "MCP setup | Five to Nine",
    description,
    pathname: "/mcp/setup",
  });

const MCP_ENDPOINT = "https://0509.io/api/mcp";

export default function McpSetupRoute() {
  const rootData = useRouteLoaderData("root") as RootLoaderData | undefined;

  return (
    <PublicDocShell
      kicker="Developer access"
      title="Connect Five to Nine to your AI tools"
      intro="One paste is all it takes: create a customer API key, then add the Five to Nine MCP endpoint to Claude Desktop, ChatGPT, pi, or any MCP-capable agent. Your saved competitive evidence becomes queryable from the tools you already work in."
    >
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: "MCP setup | Five to Nine",
            description,
            pathname: "/mcp/setup",
          }),
        )}
      />

      <PublicDocBlock title="1. Create an API key">
        <p>
          Sign in to your workspace and open{" "}
          <Link to={appLinkTarget("/app/developer-access", rootData?.session)}>Developer access</Link>.
          Create a customer API key and copy it. Read-only keys expose your
          saved evidence and readiness; write-enabled keys also run the
          documented approved account actions. Keys are shown once, stored
          hashed, and can be revoked from the same screen.
        </p>
        <p>
          API and MCP access are a plan-gated feature — create the key from an
          account whose plan includes{" "}
          <Link to={appLinkTarget("/app/billing", rootData?.session)}>developer access</Link>,
          then keep the key private like a password.
        </p>
      </PublicDocBlock>

      <PublicDocBlock title="2. Claude Desktop">
        <p>
          In Claude Desktop, open Settings, add an MCP server, and choose the
          HTTP / server-sent-events option. Paste this configuration so Claude
          can reach Five to Nine with your key:
        </p>
        <pre className="f9-code-block">
          <code>{`{
  "mcpServers": {
    "five-to-nine": {
      "url": "${MCP_ENDPOINT}",
      "headers": {
        "Authorization": "Bearer f9_live_YOUR_KEY"
      }
    }
  }
}`}</code>
        </pre>
        <p>
          Replace <code>f9_live_YOUR_KEY</code> with the key you created above.
          Claude re-lists the tools on reconnect and you can ask about your
          saved watchlists, collections, digests, and evidence.
        </p>
      </PublicDocBlock>

      <PublicDocBlock title="3. ChatGPT">
        <p>
          ChatGPT custom GPTs and connectors accept a custom MCP endpoint. Add
          Five to Nine as an external tool with a bearer-token header:
        </p>
        <ul className="f9-doc-list">
          <li>
            <strong>Endpoint URL:</strong> <code>{MCP_ENDPOINT}</code>
          </li>
          <li>
            <strong>Authentication:</strong>{" "}
            <code>Authorization: Bearer f9_live_YOUR_KEY</code>
          </li>
          <li>
            <strong>Protocol:</strong> MCP over HTTP (JSON-RPC 2.0)
          </li>
        </ul>
        <p>
          ChatGPT loads the tool list from the endpoint, so no tool names are
          hardcoded. Ask it to read your saved evidence or run an approved
          action once it is connected.
        </p>
      </PublicDocBlock>

      <PublicDocBlock title="4. pi and other MCP clients">
        <p>
          Any MCP-capable client that supports a remote HTTP MCP server can
          point at the same endpoint with the same bearer token. The
          command-line equivalent is:
        </p>
        <pre className="f9-code-block">
          <code>{`export FIVE_TO_NINE_TOKEN='f9_live_YOUR_KEY'
# point your MCP client at:
# ${MCP_ENDPOINT}
# with header: Authorization: Bearer $FIVE_TO_NINE_TOKEN`}</code>
        </pre>
        <p>
          The endpoint speaks MCP 2025-06-18 and returns the same audited tool
          set the{" "}
          <Link to="/api/docs">API docs</Link> describe.
        </p>
      </PublicDocBlock>

      <PublicDocBlock title="5. Test your connection">
        <p>
          Paste your key and run a live check. It calls the real endpoint the
          same way a connector does and reports the tools it can see.
        </p>
        <McpConnectionTest />
      </PublicDocBlock>

      <PublicDocBlock title="After connecting">
        <ul className="f9-doc-list">
          <li>Ask about recent competitive changes to your saved watchlists.</li>
          <li>Export a collection as JSON into a research note.</li>
          <li>Draft a counter-move brief from your longest-running ads.</li>
          <li>Keep the key private and revoke it from Developer access if it ever leaks.</li>
        </ul>
        <p>
          Endpoints, limits, and approved actions are listed in the{" "}
          <Link to="/api/docs">API docs</Link>. The{" "}
          <Link to="/docs#ai-agents">main docs</Link> cover using Five to Nine
          from Claude, ChatGPT, and AI agents.
        </p>
      </PublicDocBlock>
    </PublicDocShell>
  );
}
