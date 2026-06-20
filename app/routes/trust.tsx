import { Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { PublicDocBlock, PublicDocShell } from "~/components/public-doc-shell";
import { AGENT_BLOCKED_CAPABILITIES } from "~/lib/agent-action-catalog";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

const description =
  "Five to Nine trust and security basics, including data handled, retention, backups, subprocessors, and non-claims.";

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
      <PublicDocBlock title="Security contact and vulnerability intake">
        <p>
          Send security reports to <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>. Include the affected
          URL, reproduction steps, expected impact, and whether any customer data may be involved.
          The same contact is published in <a href="/.well-known/security.txt">security.txt</a>.
        </p>
      </PublicDocBlock>

      <PublicDocBlock title="Data handled">
        <p>
          Five to Nine stores account records, saved searches, watchlists, boards, notes, reports,
          share links, delivery targets, customer API keys, proof captures, landing-page snapshots,
          source URLs, delivery attempts, and operational logs needed to run the product.
        </p>
      </PublicDocBlock>

      <PublicDocBlock title="Retention and backups">
        <p>
          Product data lives in Cloudflare D1 and optional R2 artifact storage. Retention cleanup
          runs on bounded scheduled sweeps, and D1 backup/export runbooks are documented internally.
          Account deletion, correction, and export help are handled through support.
        </p>
      </PublicDocBlock>

      <PublicDocBlock title="Subprocessors and providers">
        <ul className="f9-doc-list">
          <li>Cloudflare: hosting, Workers, D1, R2, Workers AI, and Cloudflare Email Service.</li>
          <li>Dodo Payments: checkout, subscriptions, receipts, and billing portal.</li>
          <li>Meta public Ad Library surfaces and customer-provided Meta access when the customer connects it.</li>
          <li>Slack incoming webhooks when a customer connects Slack delivery.</li>
          <li>WhatsApp Cloud API only after the provider/customer lane is deliberately configured and verified.</li>
        </ul>
      </PublicDocBlock>

      <PublicDocBlock title="Honest non-claims">
        <p>
          Five to Nine does not currently claim SOC 2, HIPAA, GDPR compliance, zero retention,
          no training, automated unsupported-channel ingestion, broad public write APIs beyond audited
          workspace actions, or automated spend/reach/impression benchmarks. See <Link to="/privacy">Privacy</Link> and{" "}
          <Link to="/terms">Terms</Link> for the plain-English operating policy.
        </p>
        <p>
          Agent tools also do not perform {AGENT_BLOCKED_CAPABILITIES.join(", ")}. Those stay app-owned,
          support-owned, or not live until safe approval paths exist.
        </p>
      </PublicDocBlock>
    </PublicDocShell>
  );
}
