import { Link, useRouteLoaderData } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

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
  "Five to Nine product docs for setup, delivery, billing, integrations, and safety.";

export const links: LinksFunction = () => canonicalLinks("/docs");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Docs | Five to Nine",
    description,
    pathname: "/docs",
  });

export default function DocsRoute() {
  const rootData = useRouteLoaderData("root") as RootLoaderData | undefined;

  return (
    <PublicDocShell
      kicker="Docs"
      title="Five to Nine docs."
      intro="Task-focused guidance for finding one competitor, judging the proof, saving the work, and knowing what your plan actually includes. This documentation does not measure live provider availability."
    >
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({ name: "Docs | Five to Nine", description, pathname: "/docs" }),
        )}
      />
      <nav className="f9-doc-toc" aria-label="On this page">
        <span className="f9-doc-toc-label">On this page</span>
        <ul>
          <li><a href="#first-search">Run a trustworthy first search</a></li>
          <li><a href="#proof-labels">Understand the proof labels</a></li>
          <li><a href="#troubleshoot">Troubleshoot empty or partial results</a></li>
          <li><a href="#plan-boundaries">Plan boundaries</a></li>
          <li><a href="#ai-agents">Use Five to Nine from AI agents</a></li>
          <li><a href="#coverage-trust">Coverage and trust boundaries</a></li>
          <li><a href="#key-docs">Key docs</a></li>
        </ul>
      </nav>

      <PublicDocBlock id="first-search" title="Run a trustworthy first search">
        <ol className="f9-numbered-guide">
          <li>
            Open <Link to="/search?query=nykaa&mode=advertiser&website=https%3A%2F%2Fnykaa.com">the Nykaa search example</Link> or paste a competitor website into Search. Provider availability can vary.
          </li>
          <li>Check the source, verification label, and freshness before relying on a result.</li>
          <li>Use broader matches only as candidates. They are not proof that an ad belongs to the website.</li>
          <li>Create an account only when the evidence is useful enough to retain as a watchlist.</li>
        </ol>
      </PublicDocBlock>

      <PublicDocBlock id="proof-labels" title="Understand the proof labels">
        <dl className="proof-trail-list">
          <div>
            <dt>Verified</dt>
            <dd>The result is linked to the requested competitor by the active search pipeline.</dd>
          </div>
          <div>
            <dt>Related or broader</dt>
            <dd>A useful lead that still needs human review before it becomes a competitor claim.</dd>
          </div>
          <div>
            <dt>Cached</dt>
            <dd>Previously captured provider evidence. Read its capture time before treating it as current.</dd>
          </div>
          <div>
            <dt>Sample</dt>
            <dd>Static product walkthrough data, always labeled sample-only and never presented as a live result.</dd>
          </div>
        </dl>
      </PublicDocBlock>

      <PublicDocBlock id="troubleshoot" title="Troubleshoot empty or partial results">
        <p>
          No evidence is not proof that a competitor has no active ads. Coverage can be partial, delayed,
          cached, or unavailable. Try the brand name with the website, review broader candidates manually,
          and check <Link to="/status">Status</Link> for what the public page does and does not measure.
          If a known active campaign still does not appear, open <Link to="/help">Help</Link> instead of
          treating the empty state as a market conclusion.
        </p>
      </PublicDocBlock>

      <PublicDocBlock id="plan-boundaries" title="Plan boundaries">
        <p>These are documented plan entitlements, not a live availability guarantee; account and provider readiness still apply.</p>
        <ul className="f9-doc-list">
          <li>Free plan scope: one competitor with an instant first scan, then a weekly scheduled check and a weekly email brief backed by one proof capture a month. Includes one Collection and never asks for a card. No instant alerts, manual refresh, or exports — paid plans add 3–6 hour checks and more competitors.</li>
          <li>Scout plan scope: three scheduled watchlists, a six-hour cadence, weekly email briefs, ten collections, and 50 included evidence checks each month.</li>
          <li>Starter plan scope: daily briefs, urgent alerts, evidence capture, and exports, with ten watchlists on a three-hour cadence.</li>
          <li>Agency plan scope: client reports, share links, PDF delivery, branding, API/MCP access, and team seats.</li>
          <li>Unavailable actions should appear locked before click; server-side plan checks still apply.</li>
        </ul>
      </PublicDocBlock>

      <PublicDocBlock id="ai-agents" title="Use Five to Nine from Claude, ChatGPT, and AI agents">
        <p>
          Five to Nine speaks MCP (Model Context Protocol), so compatible assistants and agents can
          read your saved competitive evidence and run approved workspace actions. Connect a client
          to the endpoint with a customer API key from{" "}
          <Link to={appLinkTarget("/app/developer-access", rootData?.session)}>Developer access</Link> as the bearer token:
        </p>
        <pre className="f9-code-block">
          <code>{`https://0509.io/api/mcp
Authorization: Bearer f9_live_...`}</code>
        </pre>
        <p>Example prompts once connected:</p>
        <ul className="f9-doc-list">
          <li>
            &ldquo;Check my Five to Nine watchlists and summarize which competitors changed their
            offers or landing pages this week.&rdquo;
          </li>
          <li>
            &ldquo;Export my &lsquo;Skincare rivals&rsquo; collection from Five to Nine as JSON and
            draft a counter-move brief from the three longest-running ads.&rdquo;
          </li>
        </ul>
        <p>
<<<<<<< HEAD
          Honest boundary: API and MCP access are an Agency-plan feature. Read-only keys cover
          readiness and exports; write-enabled keys unlock only the documented approved actions —
          see <Link to="/api/docs">API docs</Link> for endpoints and limits. The{" "}
          <Link to="/mcp/setup">one-paste MCP setup</Link> has ready-made snippets for Claude
          Desktop, ChatGPT, and pi.
=======
          Honest boundary: read-only API and MCP access works on Free and Scout; CSV exports
          and write-enabled keys start at Starter+, and the full approved-actions surface stays
          on Agency. Read-only keys cover readiness and exports; write-enabled keys unlock only
          the documented approved actions — see <Link to="/api/docs">API docs</Link> for endpoints and limits.
>>>>>>> cb37d45c (feat(api): move read-only MCP/API access down to free + Scout (BET 6, issue #1275))
        </p>
      </PublicDocBlock>

      <PublicDocBlock id="coverage-trust" title="Coverage and trust boundaries">
        <ul className="f9-doc-list">
          <li>Do not infer spend, reach, impressions, ROAS, or a winning creative from public evidence.</li>
          <li>Broad unsupported-channel monitoring and automatic client sends are not offered.</li>
          <li>Social connectors and their delivery claims remain unavailable unless the signed-in product explicitly marks them ready.</li>
          <li>Five to Nine does not claim SOC 2, HIPAA, GDPR compliance, zero retention, or no-training guarantees.</li>
        </ul>
      </PublicDocBlock>

      <PublicDocBlock id="key-docs" title="Key docs">
        <div className="f9-doc-link-grid">
          <Link to="/help">Help</Link>
          <Link to="/api/docs">API docs</Link>
          <Link to="/mcp/setup">MCP setup</Link>
          <Link to="/status">Status</Link>
          <Link to="/changelog">Changelog</Link>
          <Link to="/trust">Trust and security</Link>
          <Link to="/privacy">Privacy</Link>
        </div>
      </PublicDocBlock>
    </PublicDocShell>
  );
}
