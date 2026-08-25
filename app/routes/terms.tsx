import type { ReactNode } from "react";
import { Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { BrandWordmark } from "~/components/brand-wordmark";
import {
  canonicalLinks,
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
} from "~/lib/seo";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

const termsDescription =
  "Terms for Five to Nine, including billing, acceptable use, and tracking limits.";

export const links: LinksFunction = () => canonicalLinks("/terms");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Terms | Five to Nine",
    description: termsDescription,
    pathname: "/terms",
  });

export default function TermsRoute() {
  return (
    <main className="f9-legal-page">
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: "Terms | Five to Nine",
            description: termsDescription,
            pathname: "/terms",
          }),
        )}
      />
      <SimpleHeader />
      <section className="f9-container f9-legal-section">
        <article className="f9-legal-card">
          <span className="f9-wk-kick">Terms</span>
          <h1>Five to Nine terms.</h1>
          <p>These plain-English operating terms cover accounts using Five to Nine.</p>

          <LegalBlock title="Product status">
            <p>
              The product helps teams search competitor ads, save evidence, create watchlists, and review
              source-backed monitoring outputs. Recent results, delayed checks, and fresh checks are labeled honestly wherever
              they appear.
            </p>
          </LegalBlock>

          <LegalBlock title="Billing">
            <p>
              Paid access follows the confirmed payment path connected to the account. Card and invoice tasks can use
              the hosted billing portal on the Plan &amp; billing page when it is available. Plan changes and
              cancellation stay backed by signed-in support cases until portal subscription updates are confirmed;
              cancellation stops future renewals and access continues until the end of the period you have paid for.
            </p>
            <p>
              If you need to ask about a charge, open a signed-in support case or email{" "}
              <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> if you cannot sign in, and we will troubleshoot it with the
              account trail attached and review the applicable billing and support policy.
            </p>
          </LegalBlock>

          <LegalBlock title="Tracking limits">
            <p>
              Five to Nine must label tracking status honestly. Recent results, delayed checks, and sample data must
              not be described as fresh live results. Backup Meta access must be owner-provided, tested before saving,
              and used only for that account.
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
              Signed-in customers can open support cases for account access, billing, cancellation, security,
              deletion, setup, and delivery help. Account billing, cancellation, and team-seat changes may require
              owner confirmation. Email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> from the address on the account if
              you cannot sign in. We aim to respond within two business days.
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
        <Link className="f9-brandmark" to="/">
          <BrandWordmark meta="Competitor change monitoring" />
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
