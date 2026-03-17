import Link from "next/link";

import { WAITLIST_URL, hasExternalWaitlist } from "@/lib/config";
import { demoAds } from "@/lib/demo-data";
import ScrollAnimate from "@/components/scroll-animate";

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

      {/* Hero — above the fold, no scroll animation */}
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

      {/* Signal / Features — first section below fold */}
      <section className="signal-section">
        <ScrollAnimate animation="fade-up">
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
        </ScrollAnimate>

        <div className="container card-grid">
          <ScrollAnimate animation="fade-up" delay={0}>
            <article className="feature-card">
              <p className="feature-label">Search</p>
              <h3>Start from advertisers or keywords.</h3>
              <p>
                Swap between known competitors and broader category terms without
                changing the overall flow.
              </p>
            </article>
          </ScrollAnimate>

          <ScrollAnimate animation="fade-up" delay={100}>
            <article className="feature-card">
              <p className="feature-label">Read</p>
              <h3>See angles, offers, and CTAs quickly.</h3>
              <p>
                Every result brings the creative preview, landing page, and a
                lightweight interpretation into the same view.
              </p>
            </article>
          </ScrollAnimate>

          <ScrollAnimate animation="fade-up" delay={200}>
            <article className="feature-card">
              <p className="feature-label">Filter</p>
              <h3>Keep the signal clean.</h3>
              <p>
                Use country, platform, status, and creative type filters to make
                the review feel precise instead of noisy.
              </p>
            </article>
          </ScrollAnimate>
        </div>
      </section>

      {/* Testimonials */}
      <section className="testimonial-section">
        <div className="container">
          <div className="card-grid">
            <ScrollAnimate animation="fade-up" delay={0}>
              <article className="feature-card testimonial-card">
                <blockquote className="testimonial-quote">
                  We used to spend 40 minutes pulling together a competitor brief
                  before any creative sprint. Now that&rsquo;s 5 minutes. The
                  advertiser search alone paid for itself the first week.
                </blockquote>
                <footer className="testimonial-author">
                  <p className="testimonial-name">Maya Chen</p>
                  <p className="testimonial-role">
                    Head of Growth &middot; Italic
                  </p>
                </footer>
              </article>
            </ScrollAnimate>

            <ScrollAnimate animation="fade-up" delay={100}>
              <article className="feature-card testimonial-card">
                <blockquote className="testimonial-quote">
                  The keyword search is the part I didn&rsquo;t know I needed.
                  Seeing who&rsquo;s pushing the same claims as us changed how we
                  think about differentiation&mdash;before we even write a brief.
                </blockquote>
                <footer className="testimonial-author">
                  <p className="testimonial-name">Jordan Reyes</p>
                  <p className="testimonial-role">
                    Performance Marketing Lead &middot; Luma
                  </p>
                </footer>
              </article>
            </ScrollAnimate>

            <ScrollAnimate animation="fade-up" delay={200}>
              <article className="feature-card testimonial-card">
                <blockquote className="testimonial-quote">
                  I hook this into our weekly review so the team walks in already
                  knowing what the competition ran last week. No more catching up
                  from screenshots in a Slack thread.
                </blockquote>
                <footer className="testimonial-author">
                  <p className="testimonial-name">Alex Tran</p>
                  <p className="testimonial-role">
                    Growth Engineer &middot; Branch
                  </p>
                </footer>
              </article>
            </ScrollAnimate>
          </div>
        </div>
      </section>

      {/* Workflow */}
      <section className="workflow-section">
        <ScrollAnimate animation="fade-up">
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
        </ScrollAnimate>
      </section>

      {/* Pricing */}
      <section className="pricing-section">
        <input type="checkbox" id="annual-toggle" className="sr-only" />
        <ScrollAnimate animation="fade-up">
          <div className="container">
            <div className="pricing-section-header">
              <p className="eyebrow">Pricing</p>
              <h2>Simple, transparent pricing.</h2>
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
                  For individuals getting started with ad research.
                </p>
                <ul className="pricing-features">
                  <li>10 searches per month</li>
                  <li>Basic filters (platform, status)</li>
                  <li>Single advertiser search</li>
                  <li>Ad preview</li>
                </ul>
                <a
                  className="button button-secondary pricing-cta"
                  href={WAITLIST_URL}
                  {...secondaryCtaProps}
                >
                  Get started free
                </a>
              </article>
            </ScrollAnimate>

            <ScrollAnimate animation="fade-up" delay={100}>
              <article className="pricing-card pricing-card-pro">
                <p className="pricing-recommended">Recommended</p>
                <p className="pricing-tier">Pro</p>
                <div className="pricing-price">
                  <span className="price-main price-monthly">$29</span>
                  <span className="price-main price-annual">$23</span>
                  <span className="price-per">/mo</span>
                </div>
                <p className="price-billed">Billed $276/yr</p>
                <p className="pricing-tagline">
                  For growth teams doing serious competitor research.
                </p>
                <ul className="pricing-features">
                  <li>Unlimited searches</li>
                  <li>All filters (country, platform, status, type)</li>
                  <li>Keyword + advertiser search</li>
                  <li>Saved searches</li>
                  <li>Export to CSV</li>
                  <li>Ad detail panel</li>
                </ul>
                <a
                  className="button button-primary pricing-cta"
                  href={WAITLIST_URL}
                  {...secondaryCtaProps}
                >
                  Join waitlist
                </a>
              </article>
            </ScrollAnimate>

            <ScrollAnimate animation="fade-up" delay={200}>
              <article className="pricing-card">
                <p className="pricing-tier">Team</p>
                <div className="pricing-price">
                  <span className="price-main price-monthly">$79</span>
                  <span className="price-main price-annual">$63</span>
                  <span className="price-per">/mo</span>
                </div>
                <p className="price-billed">Billed $756/yr</p>
                <p className="pricing-tagline">
                  For teams sharing intelligence across campaigns.
                </p>
                <ul className="pricing-features">
                  <li>Everything in Pro</li>
                  <li>Shared workspace</li>
                  <li>Team notes and annotations</li>
                  <li>Slack integration</li>
                  <li>Up to 10 members</li>
                  <li>Priority support</li>
                </ul>
                <a
                  className="button button-secondary pricing-cta"
                  href={WAITLIST_URL}
                  {...secondaryCtaProps}
                >
                  Join waitlist
                </a>
              </article>
            </ScrollAnimate>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="faq-section">
        <div className="container">
          <ScrollAnimate animation="fade-up">
            <div className="faq-header">
              <p className="eyebrow">FAQ</p>
              <h2>Common questions.</h2>
            </div>
          </ScrollAnimate>
          <div className="faq-list">
            <ScrollAnimate animation="fade-up" delay={0}>
              <details className="faq-item">
                <summary className="faq-question">
                  What data sources does 0509 use?
                </summary>
                <div className="faq-answer">
                  <p>
                    0509 pulls from the Meta Ad Library — the same publicly
                    available data you can access directly. The difference is how
                    we structure and surface it. We make the search faster,
                    results more readable, and the workflow tighter so you spend
                    time on analysis, not navigation.
                  </p>
                </div>
              </details>
            </ScrollAnimate>

            <ScrollAnimate animation="fade-up" delay={60}>
              <details className="faq-item">
                <summary className="faq-question">
                  How is this different from just using Meta Ad Library directly?
                </summary>
                <div className="faq-answer">
                  <p>
                    The native Ad Library is designed for transparency
                    compliance, not research workflows. 0509 adds a cleaner
                    search interface, side-by-side ad comparison, keyword search
                    across creative copy, quick-read summaries of angle and
                    offer, and saved searches — none of which exist natively. It
                    turns a 40-minute manual pull into a 5-minute review.
                  </p>
                </div>
              </details>
            </ScrollAnimate>

            <ScrollAnimate animation="fade-up" delay={120}>
              <details className="faq-item">
                <summary className="faq-question">
                  Can I track competitors over time?
                </summary>
                <div className="faq-answer">
                  <p>
                    Yes, on Pro and Team plans. Saved searches let you re-run the
                    same advertiser or keyword query to see what changed. We&rsquo;re
                    building scheduled digests so you can get a weekly diff
                    without having to remember to check.
                  </p>
                </div>
              </details>
            </ScrollAnimate>

            <ScrollAnimate animation="fade-up" delay={180}>
              <details className="faq-item">
                <summary className="faq-question">
                  What platforms are supported?
                </summary>
                <div className="faq-answer">
                  <p>
                    Right now 0509 focuses on Meta (Facebook and Instagram ads).
                    Google and TikTok ad intelligence are on the roadmap. Join
                    the waitlist and you&rsquo;ll hear when each platform ships.
                  </p>
                </div>
              </details>
            </ScrollAnimate>

            <ScrollAnimate animation="fade-up" delay={240}>
              <details className="faq-item">
                <summary className="faq-question">Is there an API?</summary>
                <div className="faq-answer">
                  <p>
                    Not yet. An API for programmatic access to search results and
                    ad data is planned for a future release. If you have a
                    specific integration use case, mention it when you join the
                    waitlist — that feedback shapes the roadmap.
                  </p>
                </div>
              </details>
            </ScrollAnimate>

            <ScrollAnimate animation="fade-up" delay={300}>
              <details className="faq-item">
                <summary className="faq-question">
                  How does pricing work?
                </summary>
                <div className="faq-answer">
                  <p>
                    There&rsquo;s a free tier with 10 searches per month and basic
                    filters — enough to evaluate whether 0509 fits your workflow.
                    Pro ($29/mo or $23/mo billed annually) adds unlimited searches,
                    all filters, saved searches, and export. Team ($79/mo) layers
                    shared workspaces and Slack integration on top of Pro. No
                    contracts, cancel any time.
                  </p>
                </div>
              </details>
            </ScrollAnimate>

            <ScrollAnimate animation="fade-up" delay={360}>
              <details className="faq-item">
                <summary className="faq-question">
                  When does full access launch?
                </summary>
                <div className="faq-answer">
                  <p>
                    The search demo is live now — you can use it without signing
                    up. Full access with live data, saved searches, and exports is
                    rolling out to the waitlist in batches. Add your email to get
                    an invite when your spot opens.
                  </p>
                </div>
              </details>
            </ScrollAnimate>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="cta-section">
        <ScrollAnimate animation="fade-up">
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
        </ScrollAnimate>
      </section>
    </main>
  );
}
