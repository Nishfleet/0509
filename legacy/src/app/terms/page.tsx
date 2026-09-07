import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The rules for using 0509 — short, plain, and fair.",
};

export default function TermsPage() {
  return (
    <main className="legal-shell">
      <div className="container legal-container">
        <nav className="legal-breadcrumb">
          <Link href="/">0509</Link>
          <span aria-hidden="true">/</span>
          <span>Terms of Service</span>
        </nav>

        <header className="legal-header">
          <p className="eyebrow">Legal</p>
          <h1>Terms of Service</h1>
          <p className="legal-meta">Last updated: March 17, 2026</p>
        </header>

        <div className="legal-body">
          <section>
            <h2>Who we are</h2>
            <p>
              0509 (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;) is a competitor ad research tool operated as an
              independent product. By using 0509 — including the demo, waitlist, or any
              future paid product — you agree to these terms.
            </p>
          </section>

          <section>
            <h2>Acceptable use</h2>
            <p>
              0509 is built for legitimate competitive research. You may use it to explore
              publicly available ad creative, identify trends, and improve your own
              marketing. You may not use it to:
            </p>
            <ul>
              <li>Scrape, copy, or redistribute data in bulk</li>
              <li>Reverse-engineer or attack our infrastructure</li>
              <li>Misrepresent yourself or your organisation</li>
              <li>Violate any applicable law or third-party rights</li>
            </ul>
          </section>

          <section>
            <h2>The demo</h2>
            <p>
              The search demo is provided free of charge for evaluation purposes. Demo
              data is synthetic and does not represent any real advertiser unless
              explicitly stated. We may change, limit, or remove the demo at any time
              without notice.
            </p>
          </section>

          <section>
            <h2>Intellectual property</h2>
            <p>
              All original content, design, and code in 0509 belongs to us. Nothing in
              these terms transfers ownership to you. The ad creative surfaced through
              search belongs to the respective advertisers and is subject to their rights.
            </p>
          </section>

          <section>
            <h2>Disclaimers</h2>
            <p>
              0509 is provided &ldquo;as is&rdquo;, without warranty of any kind. We do not
              guarantee uptime, accuracy of data, or fitness for any particular purpose.
              Use your own judgement when acting on competitive intelligence.
            </p>
          </section>

          <section>
            <h2>Limitation of liability</h2>
            <p>
              To the maximum extent permitted by law, we are not liable for any indirect,
              incidental, or consequential damages arising from your use of 0509 —
              including lost profits, lost data, or business interruption.
            </p>
          </section>

          <section>
            <h2>Changes to these terms</h2>
            <p>
              We may update these terms from time to time. When we do, we&apos;ll update the
              date at the top of this page. Continued use of 0509 after a change means
              you accept the updated terms.
            </p>
          </section>

          <section>
            <h2>Contact</h2>
            <p>
              Questions about these terms? Email{" "}
              <a href="mailto:hello@0509.in">hello@0509.in</a>.
            </p>
          </section>
        </div>

        <footer className="legal-footer">
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/">Back to homepage</Link>
        </footer>
      </div>
    </main>
  );
}
