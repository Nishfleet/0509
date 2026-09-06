import { Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { PublicDocBlock, PublicDocShell } from "~/components/public-doc-shell";
import { AGENT_BLOCKED_CAPABILITIES } from "~/lib/agent-action-catalog";
import {
  canonicalLinks,
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
} from "~/lib/seo";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

const description =
  "Five to Nine trust and security basics, including data handled, retention, backups, external services, and non-claims.";

export const links: LinksFunction = () => canonicalLinks("/trust");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Trust | Five to Nine",
    description,
    pathname: "/trust",
  });

export default function TrustRoute() {
  return (
    <PublicDocShell
      kicker="Trust"
      title="Trust and security basics."
      intro="This is the current lightweight trust surface. It does not make compliance claims that have not been verified."
    >
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: "Trust | Five to Nine",
            description,
            pathname: "/trust",
          }),
        )}
      />
      <PublicDocBlock title="Security contact and vulnerability intake">
        <p>
          Send security reports to <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>. Include the affected
          URL, reproduction steps, expected impact, and whether any customer data may be involved.
          The same contact is published in <a href="/.well-known/security.txt">security.txt</a>.
        </p>
      </PublicDocBlock>

      <PublicDocBlock title="Data handled">
        <p>
          Five to Nine stores account records, saved searches, watchlists, collections, notes, reports,
          share links, delivery settings, API keys, proof-backed changes, source URLs, delivery
          attempts, and service logs needed to run the product.
        </p>
      </PublicDocBlock>

      <PublicDocBlock title="Retention and backups">
        <p>
          Product data lives in Cloudflare-managed storage, with optional artifact storage for saved
          screenshots and page records. Retention cleanup runs on bounded scheduled sweeps. Backup validation and restore
          drills remain owner-operated until recorded as verified. The public health probe is{" "}
          <code>https://0509.io/api/health</code> — it returns <code>{`{"status":"ok"}`}</code> without
          touching customer records. Account deletion, correction, and export help are handled through support.
        </p>
      </PublicDocBlock>

      <PublicDocBlock title="External services and providers">
        <ul className="f9-doc-list">
          <li>Cloudflare is configured for hosting, storage, Workers AI, and email delivery; live provider availability is not measured here.</li>
          <li>Dodo Payments is configured for checkout, subscriptions, receipts, and billing portal flows; live billing availability is not guaranteed here.</li>
          <li>Meta public Ad Library surfaces and customer-provided Meta access are provider-dependent when the customer connects them.</li>
          <li>
            Site Rep provides the assistant on anonymous public pages. Using it sends the page address,
            the visitor's question and feedback, and any name, email, or follow-up details the visitor
            chooses to submit to Site Rep for answers and requested follow-up. See Site Rep's{" "}
            <a href="https://siterep.net/privacy" rel="noreferrer" target="_blank">
              Privacy
            </a>{" "}
            and{" "}
            <a href="https://siterep.net/trust" rel="noreferrer" target="_blank">
              Trust
            </a>{" "}
            notes.
          </li>
        </ul>
      </PublicDocBlock>

      <PublicDocBlock title="Capture validity — what we refuse to alert on">
        <p>
          Alerts are backed by captured page text and source links; a screenshot joins the proof when the
          capture includes one. The capture-validity gate refuses to turn some captures into alerts at all:
          error pages, anti-bot challenge walls, cookie walls, partial SPA shells, and churn that is not a real
          change. See the{" "}
          <Link to="/capture-rules">capture rules</Link> for the full, checkable list, including which
          changes are corroborated by a screenshot and which alert without one.
        </p>
      </PublicDocBlock>

      <PublicDocBlock title="Honest non-claims">
        <p>
          Five to Nine does not currently claim SOC 2, HIPAA, GDPR compliance, zero retention,
          no training, automated unsupported-channel ingestion, broad public write APIs, or automated
          spend/reach/impression benchmarks. See <Link to="/privacy">Privacy</Link> and{" "}
          <Link to="/terms">Terms</Link> for the plain-English operating policy.
        </p>
        <p>
          Connected tools also do not perform {AGENT_BLOCKED_CAPABILITIES.join(", ")}. Those require product support,
          explicit customer approval, or verified self-serve flows before they go live.
        </p>
      </PublicDocBlock>
    </PublicDocShell>
  );
}
