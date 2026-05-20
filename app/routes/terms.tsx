import type { ReactNode } from "react";
import { Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { canonicalLinks, publicSeoMeta } from "~/lib/seo";

const description =
  "Pilot terms for Five to Nine, including billing status, acceptable use, and source-proof limits.";

export const links: LinksFunction = () => canonicalLinks("/terms");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Terms | Five to Nine",
    description,
    pathname: "/terms",
  });

export default function TermsRoute() {
  return (
    <main className="site-shell">
      <SimpleHeader />
      <section className="legal-section">
        <article className="container content-card legal-card">
          <p className="eyebrow">Terms</p>
          <h1>Five to Nine pilot terms.</h1>
          <p>
            Five to Nine is currently a pilot-readiness product. These terms are plain-English operating terms for pilot
            users and should be replaced or reviewed before broad self-serve launch.
          </p>

          <LegalBlock title="Product status">
            <p>
              The product helps teams search competitor ads, save proof, create watchlists, and review proof-backed
              monitoring outputs. Meta ads tracking is beta. Fresh discovery, billing, and customer WhatsApp delivery
              remain launch gates until verified in production.
            </p>
          </LegalBlock>

          <LegalBlock title="Billing">
            <p>
              Self-serve checkout is not live. Public prices are pilot pricing signals. Paid pilots should be activated
              manually through an agreed payment path until Razorpay checkout and signed subscription webhooks are
              verified.
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
              During pilot rollout, support, cancellation, and refund handling should happen through the founder contact
              path that approved access.
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
          <Link to="/privacy">Privacy</Link>
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
