import { Form, Link, useRouteLoaderData } from "react-router";
import type { MetaFunction } from "react-router";

import { sampleQueries } from "~/lib/demo-data";
import { PRICING_COPY } from "~/lib/pricing";
import type { RootLoaderData } from "~/root";

export const meta: MetaFunction = () => [
  { title: "Five to Nine | The market moves after you log off" },
  {
    name: "description",
    content:
      "Five to Nine helps growth teams turn competitor ad, offer, and landing-page changes into proof-backed morning intelligence.",
  },
];

export default function MarketingRoute() {
  const rootData = useRouteLoaderData("root") as RootLoaderData;
  const primaryCta = rootData.session ? "/app" : "/auth/signup";

  return (
    <main className="site-shell">
      <header className="site-header">
        <div className="container header-row">
          <Link className="brand-mark" to="/">
            <span className="brand-pill" aria-hidden="true">
              09
            </span>
            <span>
              <strong>Five to Nine</strong>
              <small>After-hours market intelligence</small>
            </span>
          </Link>

          <nav className="site-nav" aria-label="Primary">
            <a href="#intelligence">Intelligence room</a>
            <Link to="/search">Search</Link>
            <a href="#pricing">Pricing</a>
            <Link className="nav-cta" to={primaryCta}>
              {rootData.session ? "Open workspace" : "Enter pilot"}
            </Link>
          </nav>
        </div>
      </header>

      <section className="hero-section">
        <div className="container hero-grid">
          <div className="hero-copy">
            <p className="signal-line">
              <span className="status-dot" />
              After-hours signal
            </p>
            <h1>The market moves after you log off.</h1>
            <p className="hero-lead">
              Five to Nine watches competitor ads, offers, and landing pages while your team sleeps, then turns
              source-backed changes into a morning brief your team can act on.
            </p>
            <div className="hero-actions">
              <Link className="button button-primary" to={primaryCta}>
                {rootData.session ? "Open workspace" : "Enter pilot"}
              </Link>
              <Link className="button button-secondary" to="/search">
                Search the public index
              </Link>
            </div>
            <p className="hero-truth">
              Every signal shows its source. Live, cached, degraded, or demo is always labeled.
            </p>
            <div className="hero-samples">
              <span>Tonight’s watch terms:</span>
              {sampleQueries.keyword.map((query) => (
                <Link
                  className="sample-pill"
                  key={query}
                  to={`/search?mode=keyword&query=${encodeURIComponent(query)}`}
                >
                  {query}
                </Link>
              ))}
            </div>
          </div>

          <aside className="hero-intel" aria-label="Market intelligence preview">
            <div className="glass-object" aria-hidden="true" />
            <div className="dossier-sheet dossier-sheet-back">
              <span>Competitor dossier</span>
              <strong>India watchlist</strong>
              <p>Last scan: pilot review queue</p>
            </div>
            <div className="dossier-sheet">
              <span>Competitor dossier</span>
              <strong>boAt / Nykaa / Meesho</strong>
              <dl>
                <div>
                  <dt>New creatives</dt>
                  <dd>Captured</dd>
                </div>
                <div>
                  <dt>Offer shifts</dt>
                  <dd>Queued</dd>
                </div>
                <div>
                  <dt>Landing page motion</dt>
                  <dd>Needs proof</dd>
                </div>
              </dl>
            </div>
            <div className="intel-browser">
              <div className="browser-topline">
                <span />
                <span />
                <span />
                <p>facebook.com/ads/library</p>
              </div>
              <div className="ad-evidence">
                <div>
                  <small>Ad Library</small>
                  <strong>Active source trail</strong>
                </div>
                <p>Hook, offer, destination, and proof state stay tied together.</p>
                <span className="evidence-chip">Evidence ready</span>
              </div>
            </div>
            <div className="evidence-note">
              <span>Offer change detected</span>
              <p>Before: sale-first creative</p>
              <p>After: bundle-first hook</p>
              <small>Source status visible before delivery</small>
            </div>
            <div className="intelligence-note">
              <span>Intelligence note</span>
              <p>Competitor motion becomes a founder-reviewed morning brief, not an unsupported AI summary.</p>
            </div>
            <div className="pilot-tag">
              <span>Pilot signal</span>
              <strong>05-09</strong>
            </div>
          </aside>
        </div>
      </section>

      <section className="comparison-section" id="intelligence">
        <div className="container section-grid two-column">
          <article className="content-card">
            <p className="section-label">Why now</p>
            <h2>Most teams study the market in daylight. The market does not wait.</h2>
            <p>
              Between end-of-day and the next standup, competitors launch new ads, change offers,
              and swap landing pages. Five to Nine is built for that gap: efficient monitoring,
              selective proof, and source status that stays visible.
            </p>
          </article>
          <article className="content-card">
            <p className="section-label">India-first truth</p>
            <ul className="bullet-list">
              <li>India is the default market, not an afterthought buried in filters.</li>
              <li>Language labels and tags reflect the way Indian growth teams actually talk.</li>
              <li>Pricing adapts by region, but the core use cases still start with Indian agencies.</li>
            </ul>
          </article>
        </div>
      </section>

      <section className="workflow-section">
        <div className="container">
          <p className="section-label">How it works</p>
          <h2 className="section-heading">A night watch for growth teams.</h2>
          <div className="feature-grid">
            <article className="feature-card">
              <span className="feature-number">01</span>
              <h3>Search by advertiser or keyword</h3>
              <p>
                Start with a brand, a hook, or a market phrase like “COD” or “free shipping”.
                Save the query once, then let the watchlist keep checking for change.
              </p>
            </article>
            <article className="feature-card">
              <span className="feature-number">02</span>
              <h3>Capture proof only when it matters</h3>
              <p>
                Five to Nine does not recapture every landing page on every run. It spends proof budget selectively,
                then stores screenshot, HTML, extracted fields, and capture time together.
              </p>
            </article>
            <article className="feature-card">
              <span className="feature-number">03</span>
              <h3>Surface only the changes worth interrupting for</h3>
              <p>
                Watchlists keep a real run history, confirm meaningful changes, and prepare the right ones
                for email-first delivery with clear confidence.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="workspace-section">
        <div className="container section-grid two-column">
          <article className="content-card">
            <p className="section-label">The hook</p>
            <h2>Five to Nine turns competitor motion into a morning brief with receipts.</h2>
            <p>
              The app is the control panel. The product closes the gap between checking now and finding out too late:
              scan cheaply, prove selectively, confirm carefully, and deliver conservatively.
            </p>
          </article>
          <article className="content-card">
            <p className="section-label">The real business</p>
            <ul className="bullet-list">
              <li>Time saved replacing repeated manual checks.</li>
              <li>Visibility into changing offers, hooks, and landing pages.</li>
              <li>A trusted alert history that survives the next sprint or client handoff.</li>
            </ul>
          </article>
        </div>
      </section>

      <section className="pricing-section" id="pricing">
        <div className="container">
          <div className="pricing-header">
            <div>
              <p className="section-label">Pricing</p>
              <h2 className="section-heading">Pilot access stays deliberate.</h2>
            </div>
            <Form className="region-switch" method="post" action="/pricing-region">
              <input name="redirectTo" type="hidden" value="/" />
              <label className="field field-inline">
                <span>Region</span>
                <select defaultValue={rootData.pricingRegion} name="region">
                  <option value="india">India</option>
                  <option value="rest_of_world">Rest of world</option>
                </select>
              </label>
              <button className="button button-secondary" type="submit">
                Save region
              </button>
            </Form>
          </div>

          <p className="region-caption">
            Showing {PRICING_COPY[rootData.pricingRegion].label.toLowerCase()} in{" "}
            {PRICING_COPY[rootData.pricingRegion].currency}. Self-serve checkout is not live yet; pilot access is
            activated manually after fit review.
          </p>

          <div className="pricing-grid">
            {rootData.pricingPlans.map((plan) => {
              const checkoutOptions = rootData.razorpayCheckout[plan.slug];
              const canUseRazorpay =
                rootData.session &&
                rootData.pricingRegion === "india" &&
                (checkoutOptions.monthly || checkoutOptions.yearly);

              return (
                <article className="pricing-card" key={plan.name}>
                  <p className="eyebrow">{plan.name}</p>
                  <h3>{plan.monthlyLabel}</h3>
                  <p className="muted-text">{plan.yearlyLabel}</p>
                  <p>{plan.detail}</p>
                  {canUseRazorpay ? (
                    <div className="billing-actions">
                      {checkoutOptions.monthly ? (
                        <Form method="post" action="/api/billing/razorpay/subscription">
                          <input name="plan" type="hidden" value={plan.slug} />
                          <input name="cycle" type="hidden" value="monthly" />
                          <button className="button button-primary" type="submit">
                            Start monthly
                          </button>
                        </Form>
                      ) : null}
                      {checkoutOptions.yearly ? (
                        <Form method="post" action="/api/billing/razorpay/subscription">
                          <input name="plan" type="hidden" value={plan.slug} />
                          <input name="cycle" type="hidden" value="yearly" />
                          <button className="button button-secondary" type="submit">
                            Start yearly
                          </button>
                        </Form>
                      ) : null}
                    </div>
                  ) : rootData.session ? (
                    <Link className="button button-primary" to={primaryCta}>
                      Open workspace
                    </Link>
                  ) : (
                    <Link className="button button-primary" to={primaryCta}>
                      Enter pilot
                    </Link>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <div className="container footer-row">
          <p>Five to Nine is in pilot-readiness mode. Meta ads tracking is beta; fresh discovery, billing, and WhatsApp delivery stay gated until verified.</p>
          <nav aria-label="Footer">
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
