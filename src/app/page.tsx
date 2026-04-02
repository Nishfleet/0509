import Link from "next/link";

import { WAITLIST_URL, hasExternalWaitlist } from "@/lib/config";
import ScrollAnimate from "@/components/scroll-animate";

const secondaryCtaProps = hasExternalWaitlist
  ? { rel: "noreferrer", target: "_blank" as const }
  : {};

export default function Home() {
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
            </span>
          </Link>
          <nav className="site-nav" aria-label="Primary">
            <Link href="/search">Demo</Link>
            <Link href="/#pricing">Pricing</Link>
            <a
              className="nav-cta"
              href={WAITLIST_URL}
              {...secondaryCtaProps}
            >
              Get early access
            </a>
          </nav>
        </div>
      </header>

      {/* ─── HERO ─── */}
      <section className="hero-section">
        <div className="container hero-grid">
          <div className="hero-copy">
            <h1>
              See every ad your competitors are running.
            </h1>
            <p className="hero-lead">
              0509 makes the Meta Ad Library actually usable. Search by
              advertiser or keyword, filter by country and platform, and read
              the creative without the clutter.
            </p>
            <div className="cta-row">
              <a
                className="button button-primary"
                href={WAITLIST_URL}
                {...secondaryCtaProps}
              >
                Get early access
              </a>
              <Link className="button button-secondary" href="/search">
                Try the demo
              </Link>
            </div>
          </div>

          <aside className="hero-preview" aria-hidden="true">
            <div className="mock-window">
              <div className="mock-titlebar">
                <span className="mock-dot" />
                <span className="mock-dot" />
                <span className="mock-dot" />
                <span className="mock-url">0509.in/search</span>
              </div>
              <div className="mock-body">
                <div className="mock-searchbar">
                  <span className="mock-mode">Advertiser</span>
                  <span className="mock-query">nike</span>
                  <span className="mock-cursor" />
                </div>
                <div className="mock-filters">
                  <span className="mock-chip">US</span>
                  <span className="mock-chip">Instagram</span>
                  <span className="mock-chip">Active</span>
                  <span className="mock-chip">Video</span>
                </div>
                <div className="mock-results">
                  <div className="mock-card">
                    <div className="mock-card-badge">Video</div>
                    <div className="mock-card-title">Nike Running</div>
                    <div className="mock-card-hook">
                      Just Do It. Your next PR starts here.
                    </div>
                    <div className="mock-card-meta">US, GB &middot; Active since Mar 2</div>
                  </div>
                  <div className="mock-card">
                    <div className="mock-card-badge">Image</div>
                    <div className="mock-card-title">Nike Training</div>
                    <div className="mock-card-hook">
                      Free 30-day training plan inside.
                    </div>
                    <div className="mock-card-meta">US &middot; Active since Feb 18</div>
                  </div>
                  <div className="mock-card mock-card-fade">
                    <div className="mock-card-badge">Carousel</div>
                    <div className="mock-card-title">Nike Jordan</div>
                    <div className="mock-card-hook">
                      Limited drop. Don&rsquo;t sleep on it.
                    </div>
                    <div className="mock-card-meta">US, CA &middot; Active since Mar 8</div>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </section>

      {/* ─── TRUST BAR ─── */}
      <section className="trust-section">
        <div className="container trust-row">
          <div className="trust-item">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            <span>Built on Meta Ad Library API</span>
          </div>
          <div className="trust-item">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            <span>Facebook + Instagram ads</span>
          </div>
          <div className="trust-item">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            <span>Real-time data</span>
          </div>
          <div className="trust-item">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            <span>No login required for demo</span>
          </div>
        </div>
      </section>

      {/* ─── WHY NOT JUST USE AD LIBRARY ─── */}
      <section className="compare-section">
        <ScrollAnimate animation="fade-up">
          <div className="container compare-grid">
            <div className="compare-col compare-before">
              <p className="compare-label">Meta Ad Library</p>
              <ul>
                <li>One search mode, no keyword search</li>
                <li>No filters for creative type</li>
                <li>Results are a wall of text</li>
                <li>No way to save or compare</li>
                <li>Built for compliance, not research</li>
              </ul>
            </div>
            <div className="compare-col compare-after">
              <p className="compare-label">0509</p>
              <ul>
                <li>Advertiser + keyword search</li>
                <li>Filter by country, platform, type, status</li>
                <li>Creative preview with angle + offer</li>
                <li>Save searches, bookmark ads</li>
                <li>Built for growth teams</li>
              </ul>
            </div>
          </div>
        </ScrollAnimate>
      </section>

      {/* ─── FEATURES ─── */}
      <section className="features-section" id="features">
        <div className="container">
          <ScrollAnimate animation="fade-up">
            <p className="section-label">How it works</p>
            <h2 className="section-heading">
              From search to insight in 30 seconds.
            </h2>
          </ScrollAnimate>

          <div className="feature-grid">
            <ScrollAnimate animation="fade-up" delay={0}>
              <article className="feature-card">
                <span className="feature-number">01</span>
                <h3>Search by advertiser or keyword</h3>
                <p>
                  Know the brand? Search by name. Exploring a category? Switch
                  to keyword mode and search by offer language, claims, or
                  product terms. Same filters, same view.
                </p>
              </article>
            </ScrollAnimate>

            <ScrollAnimate animation="fade-up" delay={80}>
              <article className="feature-card">
                <span className="feature-number">02</span>
                <h3>Read the creative, not just the metadata</h3>
                <p>
                  Every result shows the headline, hook, offer snapshot, CTA,
                  and landing page URL. You get the full picture without
                  clicking through to each ad individually.
                </p>
              </article>
            </ScrollAnimate>

            <ScrollAnimate animation="fade-up" delay={160}>
              <article className="feature-card">
                <span className="feature-number">03</span>
                <h3>Save what matters, skip the rest</h3>
                <p>
                  Bookmark ads for later. Save search configurations so you
                  can re-run them weekly. Export to CSV when you need to share
                  with the team before a strategy session.
                </p>
              </article>
            </ScrollAnimate>
          </div>
        </div>
      </section>

      {/* ─── USE CASES ─── */}
      <section className="usecases-section">
        <div className="container">
          <ScrollAnimate animation="fade-up">
            <p className="section-label">Built for</p>
            <h2 className="section-heading">
              The research that happens before campaigns ship.
            </h2>
          </ScrollAnimate>

          <div className="usecase-grid">
            <ScrollAnimate animation="fade-up" delay={0}>
              <article className="usecase-card">
                <h3>Pre-sprint competitor pulls</h3>
                <p>
                  Your creative team needs a brief before the sprint. Pull
                  every active ad from 3 competitors in 5 minutes instead
                  of 40.
                </p>
              </article>
            </ScrollAnimate>

            <ScrollAnimate animation="fade-up" delay={80}>
              <article className="usecase-card">
                <h3>Keyword-level category scans</h3>
                <p>
                  Who else is saying &ldquo;free trial&rdquo; or
                  &ldquo;limited drop&rdquo;? Search by keyword to see every
                  advertiser pushing similar language.
                </p>
              </article>
            </ScrollAnimate>

            <ScrollAnimate animation="fade-up" delay={160}>
              <article className="usecase-card">
                <h3>Weekly competitor monitoring</h3>
                <p>
                  Save your competitor searches and re-run them every Monday.
                  See what changed, what launched, and what got pulled.
                </p>
              </article>
            </ScrollAnimate>

            <ScrollAnimate animation="fade-up" delay={240}>
              <article className="usecase-card">
                <h3>Landing page + funnel research</h3>
                <p>
                  Every ad links to a landing page. Open it directly from the
                  result. See how competitors structure the click-through from
                  ad to conversion.
                </p>
              </article>
            </ScrollAnimate>
          </div>
        </div>
      </section>

      {/* ─── PRICING ─── */}
      <section className="pricing-section" id="pricing">
        <input type="checkbox" id="annual-toggle" className="sr-only" />
        <ScrollAnimate animation="fade-up">
          <div className="container">
            <div className="pricing-section-header">
              <p className="section-label">Pricing</p>
              <h2 className="section-heading">Straightforward pricing. No surprises.</h2>
              <p className="section-sub">
                AdSpy charges $149/mo for Facebook only. We think you deserve better.
              </p>
              <div className="pricing-toggle-wrap">
                <span className="pricing-billing-label">Monthly</span>
                <label
                  htmlFor="annual-toggle"
                  className="pricing-toggle-label"
                  aria-label="Switch to annual billing"
                >
                  <span className="toggle-track">
                    <span className="toggle-thumb" />
                  </span>
                </label>
                <span className="pricing-billing-label">
                  Annual{" "}
                  <span className="savings-pill">Save 20%</span>
                </span>
              </div>
            </div>
          </div>
        </ScrollAnimate>

        <div className="container">
          <div className="pricing-grid">
            <ScrollAnimate animation="fade-up" delay={0}>
              <article className="pricing-card">
                <p className="pricing-tier">Free</p>
                <div className="pricing-price">
                  <span className="price-main">$0</span>
                  <span className="price-per">/mo</span>
                </div>
                <p className="pricing-tagline">
                  Try the search. No account needed.
                </p>
                <ul className="pricing-features">
                  <li>10 searches per month</li>
                  <li>Advertiser search</li>
                  <li>Basic filters</li>
                  <li>Ad preview</li>
                </ul>
                <Link
                  className="button button-secondary pricing-cta"
                  href="/search"
                >
                  Try the demo
                </Link>
              </article>
            </ScrollAnimate>

            <ScrollAnimate animation="fade-up" delay={80}>
              <article className="pricing-card pricing-card-pro">
                <p className="pricing-recommended">Most popular</p>
                <p className="pricing-tier">Pro</p>
                <div className="pricing-price">
                  <span className="price-main price-monthly">$29</span>
                  <span className="price-main price-annual">$23</span>
                  <span className="price-per">/mo</span>
                </div>
                <p className="price-billed">Billed $276/yr on annual</p>
                <p className="pricing-tagline">
                  For growth teams doing real competitor research.
                </p>
                <ul className="pricing-features">
                  <li>Unlimited searches</li>
                  <li>Advertiser + keyword search</li>
                  <li>All filters</li>
                  <li>Saved searches</li>
                  <li>Ad bookmarks</li>
                  <li>Export to CSV</li>
                  <li>Ad detail panel</li>
                </ul>
                <a
                  className="button button-primary pricing-cta"
                  href={WAITLIST_URL}
                  {...secondaryCtaProps}
                >
                  Get early access
                </a>
              </article>
            </ScrollAnimate>

            <ScrollAnimate animation="fade-up" delay={160}>
              <article className="pricing-card">
                <p className="pricing-tier">Team</p>
                <div className="pricing-price">
                  <span className="price-main price-monthly">$79</span>
                  <span className="price-main price-annual">$63</span>
                  <span className="price-per">/mo</span>
                </div>
                <p className="price-billed">Billed $756/yr on annual</p>
                <p className="pricing-tagline">
                  Shared workspace for the whole growth org.
                </p>
                <ul className="pricing-features">
                  <li>Everything in Pro</li>
                  <li>Shared workspace</li>
                  <li>Team annotations</li>
                  <li>Slack integration</li>
                  <li>Up to 10 seats</li>
                  <li>Priority support</li>
                </ul>
                <a
                  className="button button-secondary pricing-cta"
                  href={WAITLIST_URL}
                  {...secondaryCtaProps}
                >
                  Get early access
                </a>
              </article>
            </ScrollAnimate>
          </div>
        </div>
      </section>

      {/* ─── FAQ ─── */}
      <section className="faq-section">
        <div className="container">
          <ScrollAnimate animation="fade-up">
            <div className="faq-header">
              <p className="section-label">FAQ</p>
              <h2 className="section-heading">Common questions.</h2>
            </div>
          </ScrollAnimate>
          <div className="faq-list">
            <ScrollAnimate animation="fade-up" delay={0}>
              <details className="faq-item">
                <summary className="faq-question">
                  What data does 0509 use?
                </summary>
                <div className="faq-answer">
                  <p>
                    The Meta Ad Library API. The same publicly available data
                    you can access directly. 0509 makes the search faster, the
                    results more structured, and the workflow tighter.
                  </p>
                </div>
              </details>
            </ScrollAnimate>

            <ScrollAnimate animation="fade-up" delay={50}>
              <details className="faq-item">
                <summary className="faq-question">
                  Why not just use Meta Ad Library directly?
                </summary>
                <div className="faq-answer">
                  <p>
                    The native Ad Library was built for transparency compliance,
                    not research. It has no keyword search, no creative type
                    filters, no way to save results, and no side-by-side
                    comparison. 0509 adds all of that.
                  </p>
                </div>
              </details>
            </ScrollAnimate>

            <ScrollAnimate animation="fade-up" delay={100}>
              <details className="faq-item">
                <summary className="faq-question">
                  Can I track competitors over time?
                </summary>
                <div className="faq-answer">
                  <p>
                    Yes. On Pro and Team plans, saved searches let you re-run
                    the same query to see what changed. Scheduled weekly digests
                    are on the roadmap.
                  </p>
                </div>
              </details>
            </ScrollAnimate>

            <ScrollAnimate animation="fade-up" delay={150}>
              <details className="faq-item">
                <summary className="faq-question">
                  What platforms are covered?
                </summary>
                <div className="faq-answer">
                  <p>
                    Facebook and Instagram (Meta) today. Google and TikTok
                    are on the roadmap. Join the waitlist to hear when each
                    ships.
                  </p>
                </div>
              </details>
            </ScrollAnimate>

            <ScrollAnimate animation="fade-up" delay={200}>
              <details className="faq-item">
                <summary className="faq-question">
                  Is there a free tier?
                </summary>
                <div className="faq-answer">
                  <p>
                    Yes. 10 searches per month with basic filters. The demo
                    is open right now with no account required. Pro is $29/mo
                    for unlimited everything.
                  </p>
                </div>
              </details>
            </ScrollAnimate>
          </div>
        </div>
      </section>

      {/* ─── FINAL CTA ─── */}
      <section className="cta-section">
        <ScrollAnimate animation="fade-up">
          <div className="container cta-panel">
            <h2>Stop spending 40 minutes on competitor pulls.</h2>
            <p>
              The demo is live. Try it now. Join the waitlist if you want
              full access with live data, saved searches, and CSV export.
            </p>
            <div className="cta-row">
              <a
                className="button button-primary"
                href={WAITLIST_URL}
                {...secondaryCtaProps}
              >
                Get early access
              </a>
              <Link className="button button-secondary" href="/search">
                Try the demo
              </Link>
            </div>
          </div>
        </ScrollAnimate>
      </section>
    </main>
  );
}
