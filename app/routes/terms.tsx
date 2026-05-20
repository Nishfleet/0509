import type { ReactNode } from "react";
import { Link } from "react-router";
import type { MetaFunction } from "react-router";

import { BrandWordmark } from "~/components/brand-wordmark";

export const meta: MetaFunction = () => [
  { title: "Terms | Five to Nine" },
  {
    name: "description",
    content: "Terms for Five to Nine, including billing, acceptable use, and source-proof limits.",
  },
];

export default function TermsRoute() {
  return (
    <main className="f9-legal-page">
      <SimpleHeader />
      <section className="f9-container f9-legal-section">
        <article className="f9-legal-card">
          <span className="f9-app-kicker">Terms</span>
          <h1>Five to Nine terms.</h1>
          <p>
            These plain-English operating terms cover accounts using Five to Nine. They should be reviewed by counsel
            before a broader commercial rollout.
          </p>

          <LegalBlock title="Product status">
            <p>
              The product helps teams search competitor ads, save proof, create watchlists, and review proof-backed
              monitoring outputs. Cached results, degraded discovery, and fresh source checks must be labeled honestly
              wherever they appear.
            </p>
          </LegalBlock>

          <LegalBlock title="Billing">
            <p>
              Paid access, subscription changes, cancellations, and refunds should follow the confirmed payment path or
              written order connected to the workspace.
            </p>
          </LegalBlock>

          <LegalBlock title="Source limits">
            <p>
              Five to Nine must label source status honestly. Cached results, degraded discovery, and demo data must not
              be described as fresh live proof. Customer Meta tokens must be customer-owned, test-before-save, and used
              only for the workspace's Meta API fallback.
            </p>
          </LegalBlock>

          <LegalBlock title="Acceptable use">
            <p>
              Use the product for legitimate competitor monitoring, growth research, and client reporting. Do not use it
              to misrepresent source data, bypass platform rules, or publish unsupported claims.
            </p>
          </LegalBlock>

          <LegalBlock title="Support">
            <p>
              Support, cancellation, and refund handling should happen through the contact path connected to the account.
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
          <Link to="/privacy">Privacy</Link>
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
