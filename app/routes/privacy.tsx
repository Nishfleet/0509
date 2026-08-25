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

const privacyDescription =
  "How Five to Nine handles account, search, monitoring, evidence, delivery, and browser-extension data.";

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
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: "Privacy | Five to Nine",
            description: privacyDescription,
            pathname: "/privacy",
          }),
        )}
      />
      <SimpleHeader />
      <section className="f9-container f9-legal-section">
        <article className="f9-legal-card">
          <span className="f9-wk-kick">Privacy</span>
          <h1>Five to Nine privacy basics.</h1>
          <p>This is a plain-English summary of the current product behavior.</p>

          <LegalBlock title="What we collect">
            <p>
              We collect account details, saved searches, watchlists, collections, notes, reports, share links, delivery
              targets, customer-provided Meta access settings, and operational logs needed to run the account.
            </p>
          </LegalBlock>

          <LegalBlock title="Evidence data">
            <p>
              The product may store ad records, landing-page snapshots, extracted text, screenshots, HTML, timestamps,
              source URLs, and delivery attempts so teams can verify what changed. Tracking status stays visible when
              results are recent, delayed, or freshly verified.
            </p>
          </LegalBlock>

          <LegalBlock title="Delivery data">
            <p>
              Email delivery is handled by Five to Nine's email provider.
            </p>
          </LegalBlock>

          <LegalBlock title="Public assistant">
            <p>
              Public pages include a Site Rep assistant. When you use it, the page address, your
              question and feedback, and any name, email, or follow-up details you choose to submit
              are sent to Site Rep to provide answers and requested follow-up. See Site Rep's{" "}
              <a href="https://siterep.net/privacy" rel="noreferrer" target="_blank">
                Privacy
              </a>{" "}
              and{" "}
              <a href="https://siterep.net/trust" rel="noreferrer" target="_blank">
                Trust
              </a>{" "}
              notes.
            </p>
          </LegalBlock>

          <LegalBlock title="Chrome extension">
            <p>
              Five to Nine — Competitor Ads uses Chrome's <code>activeTab</code> permission only when you open the
              extension. It reads the current tab's URL locally to identify the website's domain. It does not read page
              content, cookies, passwords, form data, or your broader browsing history, and it has no background
              collection, analytics, or remote code.
            </p>
            <p>
              The extension does not persist the current URL or domain. If you choose an action, it opens the selected
              0509.io page and includes the domain in that request so Five to Nine can show the brand page, run the
              search, or prefill the watchlist flow. A domain you type into the extension is handled in the same way.
              Five to Nine and the service providers needed to operate the selected action process the domain, and the
              request may be included in the operational logs described above.
            </p>
            <p>
              We do not sell this data, use it for advertising, profiling, or creditworthiness, or share it except to
              operate the action you requested or for security, legal, or compliance reasons. Five to Nine's use of
              information received from Chrome APIs complies with the Chrome Web Store User Data Policy, including its
              Limited Use requirements.
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
              For access, correction, deletion, billing, or security questions, email{" "}
              <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> from the address on the account. Account deletion
              requests are honored through the same channel.
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
