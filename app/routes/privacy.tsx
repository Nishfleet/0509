import type { ReactNode } from "react";
import { Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { BrandWordmark } from "~/components/brand-wordmark";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";

const privacyDescription =
  "How Five to Nine handles account, search, monitoring, proof, and delivery data.";

export const links: LinksFunction = () => canonicalLinks("/privacy");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Privacy | Five to Nine",
    description: privacyDescription,
    pathname: "/privacy",
  });

export default function PrivacyRoute() {
  return (
    <main className="f9-legal-page">
      <SimpleHeader />
      <section className="f9-container f9-legal-section">
        <article className="f9-legal-card">
          <span className="f9-app-kicker">Privacy</span>
          <h1>Five to Nine privacy basics.</h1>
          <p>This is a plain-English summary of the current product behavior.</p>

          <LegalBlock title="What we collect">
            <p>
              We collect account details, saved searches, watchlists, collections, notes, reports, share links, delivery
              targets, customer-provided Meta API token settings, and operational logs needed to run the workspace.
            </p>
          </LegalBlock>

          <LegalBlock title="Proof data">
            <p>
              The product may store ad records, landing-page snapshots, extracted text, screenshots, HTML, timestamps,
              source URLs, and delivery attempts so teams can verify what changed. Tracking status stays visible when
              discovery is recent, delayed, or freshly verified.
            </p>
          </LegalBlock>

          <LegalBlock title="Delivery data">
            <p>
              Email delivery uses configured email infrastructure. WhatsApp delivery, when enabled, requires opt-in,
              template readiness, validation, and webhook readiness.
            </p>
          </LegalBlock>

          <LegalBlock title="Security and compliance claims">
            <p>
              We do not claim SOC 2, HIPAA, GDPR compliance, zero retention, no training, or similar guarantees until
              the matching policy, vendor configuration, and product behavior are verified.
            </p>
          </LegalBlock>

          <LegalBlock title="Support">
            <p>
              For access, correction, deletion, billing, or security questions, use the support or account contact path
              that gave you access to the workspace.
            </p>
          </LegalBlock>
        </article>
      </section>
    </main>
  );
}

function SimpleHeader() {
  return (
    <header className="f9-legal-nav">
      <div className="f9-container f9-legal-nav-inner">
        <Link className="f9-app-brand" to="/">
          <BrandWordmark meta="Proof-backed competitor monitoring" />
        </Link>
        <nav className="f9-search-nav-links" aria-label="Legal navigation">
          <Link to="/">Home</Link>
          <Link to="/terms">Terms</Link>
        </nav>
      </div>
    </header>
  );
}

function LegalBlock(props: { title: string; children: ReactNode }) {
  return (
    <section className="f9-legal-block">
      <h2>{props.title}</h2>
      {props.children}
    </section>
  );
}
