import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How 0509 collects, uses, and protects your information.",
};

export default function PrivacyPage() {
  return (
    <main className="legal-shell">
      <div className="container legal-container">
        <nav className="legal-breadcrumb">
          <Link href="/">0509</Link>
          <span aria-hidden="true">/</span>
          <span>Privacy Policy</span>
        </nav>

        <header className="legal-header">
          <p className="eyebrow">Legal</p>
          <h1>Privacy Policy</h1>
          <p className="legal-meta">Last updated: March 17, 2026</p>
        </header>

        <div className="legal-body">
          <section>
            <h2>What we collect</h2>
            <p>
              When you join the waitlist, we collect your email address. When you use the
              search demo, we may log anonymised queries to improve the product. We do not
              collect names, payment details, or any other personal information unless you
              explicitly provide them.
            </p>
          </section>

          <section>
            <h2>How we use it</h2>
            <p>
              Your email is used solely to notify you when early access opens and to send
              product updates you asked for. We do not sell, rent, or trade email addresses
              to third parties. Ever.
            </p>
            <p>
              Anonymised usage data (search queries, page views) helps us understand what
              features matter most. This data cannot be traced back to you.
            </p>
          </section>

          <section>
            <h2>Cookies and local storage</h2>
            <p>
              The newsletter sign-up stores a record in your browser&apos;s local storage so we
              don&apos;t prompt you again after you subscribe. We do not use tracking cookies or
              third-party advertising cookies.
            </p>
          </section>

          <section>
            <h2>Third-party services</h2>
            <p>
              0509 is hosted on Cloudflare. Cloudflare may collect standard server logs
              such as IP addresses and request timestamps as part of operating the
              infrastructure.
            </p>
          </section>

          <section>
            <h2>Data retention</h2>
            <p>
              We keep waitlist emails until you unsubscribe or request deletion. You can do
              either at any time by emailing us at the address below. We will action the
              request within 7 days.
            </p>
          </section>

          <section>
            <h2>Your rights</h2>
            <p>
              You have the right to access, correct, or delete any personal data we hold
              about you. If you are in the EU or UK, you also have rights under GDPR or
              UK GDPR, including the right to data portability and the right to lodge a
              complaint with your local supervisory authority.
            </p>
          </section>

          <section>
            <h2>Contact</h2>
            <p>
              Questions or requests? Email{" "}
              <a href="mailto:privacy@0509.in">privacy@0509.in</a>. We respond to all
              privacy enquiries within 5 business days.
            </p>
          </section>
        </div>

        <footer className="legal-footer">
          <Link href="/terms">Terms of Service</Link>
          <Link href="/">Back to homepage</Link>
        </footer>
      </div>
    </main>
  );
}
