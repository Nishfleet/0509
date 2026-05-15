import type { ReactNode } from "react";
import { Link } from "react-router";
import type { MetaFunction } from "react-router";

export const meta: MetaFunction = () => [
  { title: "Privacy | Five to Nine" },
  {
    name: "description",
    content: "How Five to Nine handles account, search, monitoring, proof, and delivery data during pilot rollout.",
  },
];

export default function PrivacyRoute() {
  return (
    <main className="site-shell">
      <SimpleHeader />
      <section className="legal-section">
        <article className="container content-card legal-card">
          <p className="eyebrow">Privacy</p>
          <h1>Five to Nine privacy basics.</h1>
          <p>
            Five to Nine is in pilot-readiness mode. This page describes the current product behavior and should stay
            narrower than any future legal policy reviewed by counsel.
          </p>

          <LegalBlock title="What we collect">
            <p>
              We collect account details, saved searches, watchlists, collections, notes, reports, share links, delivery
              targets, customer-provided Meta API token settings, and operational logs needed to run the workspace.
            </p>
          </LegalBlock>

          <LegalBlock title="Proof data">
            <p>
              The product may store ad records, landing-page snapshots, extracted text, screenshots, HTML, timestamps,
              source URLs, and delivery attempts so teams can verify what changed. Meta ads tracking is beta until the
              live discovery canaries prove reliability.
            </p>
          </LegalBlock>

          <LegalBlock title="Delivery data">
            <p>
              Email delivery uses configured email infrastructure. WhatsApp delivery must remain behind opt-in,
              template-readiness, validation, and webhook-readiness checks before customer rollout.
            </p>
          </LegalBlock>

          <LegalBlock title="What we do not claim yet">
            <p>
              We do not claim SOC 2, HIPAA, GDPR compliance, zero retention, no training, or similar guarantees until
              the matching policy, vendor configuration, and product behavior are verified.
            </p>
          </LegalBlock>

          <LegalBlock title="Pilot support">
            <p>
              For access, correction, deletion, billing, or security questions during the pilot, use the founder contact
              path that gave you access to the workspace.
            </p>
          </LegalBlock>
        </article>
      </section>
    </main>
  );
}

function SimpleHeader() {
  return (
    <header className="site-header">
      <div className="container header-row">
        <Link className="brand-mark" to="/">
          <span className="brand-pill" aria-hidden="true">
            09
          </span>
          <span>
            <strong>Five to Nine</strong>
            <small>Proof-backed competitor monitoring</small>
          </span>
        </Link>
        <nav className="site-nav" aria-label="Legal navigation">
          <Link to="/">Home</Link>
          <Link to="/terms">Terms</Link>
        </nav>
      </div>
    </header>
  );
}

function LegalBlock(props: { title: string; children: ReactNode }) {
  return (
    <section className="legal-block">
      <h2>{props.title}</h2>
      {props.children}
    </section>
  );
}
