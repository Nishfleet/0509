import Link from "next/link";

import { WAITLIST_URL, hasExternalWaitlist } from "@/lib/config";
import { demoAds } from "@/lib/demo-data";

const secondaryCtaProps = hasExternalWaitlist
  ? { rel: "noreferrer", target: "_blank" as const }
  : {};

export default function Home() {
  const spotlightAds = demoAds.slice(0, 3);

  return (
    <main className="site-shell">
      <header className="site-header">
        <div className="container header-row">
          <Link className="brand-mark" href="/">
            <span className="brand-pill" aria-hidden="true">
              09
            </span>
            <span>
              <strong>0509</strong>
              <span>Competitor ad research</span>
            </span>
          </Link>
          <nav className="site-nav" aria-label="Primary">
            <Link href="/search">Open demo</Link>
            <a href={WAITLIST_URL} {...secondaryCtaProps}>
              Join waitlist
            </a>
          </nav>
        </div>
      </header>

      <section className="hero-section">
        <div className="container hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">Growth teams first</p>
            <h1>Scan competitor ads before the angle gets stale.</h1>
            <p className="hero-lead">
              0509 is a sharper way to review Meta Ad Library signal. Search by
              advertiser or keyword, compare creative angles, and move from ad
              discovery to research faster.
            </p>
            <div className="cta-row">
              <a className="button button-primary" href={WAITLIST_URL} {...secondaryCtaProps}>
                Join waitlist
              </a>
              <Link className="button button-secondary" href="/search">
                Open demo
              </Link>
            </div>
            <ul className="hero-metrics" aria-label="Product focus">
              <li>
                <strong>2</strong>
                <span>Ways to start a search</span>
              </li>
              <li>
                <strong>4</strong>
                <span>Filters to narrow the view</span>
              </li>
              <li>
                <strong>{demoAds.length}</strong>
                <span>Example ads to inspect</span>
              </li>
            </ul>
          </div>

          <aside className="hero-preview">
            <div className="preview-toolbar">
              <span className="preview-badge">Advertiser search</span>
              <span className="preview-status">Interactive demo</span>
            </div>
            <div className="preview-search">
              <span className="preview-query">motiondesk</span>
              <span className="preview-chip">Instagram</span>
              <span className="preview-chip">Video</span>
            </div>
            <div className="preview-stack">
              {spotlightAds.map((ad) => (
                <article className="preview-card" key={ad.id}>
                  <div
                    className="creative-swatch"
                    style={
                      {
                        "--swatch-accent": ad.preview.accent,
                      } as React.CSSProperties
                    }
                  >
                    <span>{ad.preview.badge}</span>
                    <strong>{ad.preview.headline}</strong>
                    <small>{ad.preview.subhead}</small>
                  </div>
                  <div className="preview-copy">
                    <p>{ad.advertiser}</p>
                    <span>{ad.hook}</span>
                  </div>
                </article>
              ))}
            </div>
          </aside>
        </div>
      </section>

      <section className="signal-section">
        <div className="container section-grid">
          <div>
            <p className="eyebrow">Product overview</p>
            <h2>A calm interface for noisy ad research.</h2>
          </div>
          <p className="section-copy">
            0509 stays focused on one workflow: finding competitor ads, reading
            the creative fast, and understanding the offer without getting
            buried in a bloated dashboard.
          </p>
        </div>

        <div className="container card-grid">
          <article className="feature-card">
            <p className="feature-label">Search</p>
            <h3>Start from advertisers or keywords.</h3>
            <p>
              Swap between known competitors and broader category terms without
              changing the overall flow.
            </p>
          </article>

          <article className="feature-card">
            <p className="feature-label">Read</p>
            <h3>See angles, offers, and CTAs quickly.</h3>
            <p>
              Every result brings the creative preview, landing page, and a
              lightweight interpretation into the same view.
            </p>
          </article>

          <article className="feature-card">
            <p className="feature-label">Filter</p>
            <h3>Keep the signal clean.</h3>
            <p>
              Use country, platform, status, and creative type filters to make
              the review feel precise instead of noisy.
            </p>
          </article>
        </div>
      </section>

      <section className="workflow-section">
        <div className="container workflow-panel">
          <div>
            <p className="eyebrow">For growth teams</p>
            <h2>Built for the research loop that happens before campaigns move.</h2>
          </div>
          <div className="workflow-list">
            <article>
              <strong>Find the competitor set</strong>
              <p>Use advertiser search when you already know the brand.</p>
            </article>
            <article>
              <strong>Expand to category language</strong>
              <p>Switch to keyword mode to see who is pushing similar claims.</p>
            </article>
            <article>
              <strong>Review the funnel context</strong>
              <p>
                Open the ad detail, check the CTA, and follow the landing page
                before the next strategy call.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="cta-section">
        <div className="container cta-panel">
          <div>
            <p className="eyebrow">Early access</p>
            <h2>See the search workflow now. Join the list for what comes next.</h2>
            <p>
              The demo stays open so the product is easy to evaluate right
              away. Join the early list if you want product updates and first
              access when invites open.
            </p>
          </div>
          <div className="cta-row">
            <a className="button button-primary" href={WAITLIST_URL} {...secondaryCtaProps}>
              Join waitlist
            </a>
            <Link className="button button-secondary" href="/search">
              Open search demo
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
