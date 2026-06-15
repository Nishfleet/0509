import { Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { PublicDocBlock, PublicDocShell } from "~/components/public-doc-shell";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

const description =
  "Help for setting up Five to Nine competitor monitoring, delivery, billing, and support.";

export const links: LinksFunction = () => canonicalLinks("/help");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Help | Five to Nine",
    description,
    pathname: "/help",
  });

export default function HelpRoute() {
  return (
    <PublicDocShell
      kicker="Help"
      title="Get Five to Nine working for your team."
      intro="The fastest path is one competitor, one watchlist, one proof capture, then one delivery channel."
    >
      <PublicDocBlock title="Start here">
        <ol className="f9-numbered-guide">
          <li>Run a public live search from the homepage or `/search`.</li>
          <li>Create an account and add one competitor website.</li>
          <li>Open the watchlist and refresh tracking to capture the first proof trail.</li>
          <li>Review the digest page after the first monitored change or quiet check.</li>
        </ol>
      </PublicDocBlock>

      <PublicDocBlock title="Delivery setup">
        <p>
          Email delivery uses Cloudflare Email Service through the app's `send_email` binding. Slack
          delivery is self-serve from <Link to="/app/sources">Integrations &amp; API</Link>: paste a
          Slack incoming webhook, let Five to Nine send the setup test, then future eligible digests
          can post there.
        </p>
        <p>
          WhatsApp is not launch-scoped today. It stays unavailable for customers until provider
          setup, opt-in, template eligibility, webhook readiness, and delivered proof are all verified.
        </p>
      </PublicDocBlock>

      <PublicDocBlock title="Billing help">
        <p>
          Plans and extra evidence-check packs use Dodo Payments. Signed-in customers can open the
          billing portal from <Link to="/app/billing">Plan &amp; billing</Link> when their account has
          a linked Dodo customer id. Portal subscription updates still depend on the Dodo dashboard
          setting described in the launch runbook.
        </p>
      </PublicDocBlock>

      <PublicDocBlock title="Contact support">
        <p>
          Email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> for account access, billing changes,
          cancellation help, deletion requests, security reports, or migration support.
        </p>
      </PublicDocBlock>
    </PublicDocShell>
  );
}
