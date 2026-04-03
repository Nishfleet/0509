import { Form, Link, useRouteLoaderData } from "react-router";
import type { MetaFunction } from "react-router";

import { sampleQueries } from "~/lib/demo-data";
import { PRICING_COPY } from "~/lib/pricing";
import type { RootLoaderData } from "~/root";

export const meta: MetaFunction = () => [
  { title: "0509 | Meta competitor analysis for growth teams" },
  {
    name: "description",
    content:
      "0509 helps growth teams decode what competitors are saying, selling, and changing on Meta with saved analysis, watchlists, and weekly digests.",
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
              <strong>0509</strong>
              <small>Meta analysis workspace</small>
            </span>
          </Link>

          <nav className="site-nav" aria-label="Primary">
            <Link to="/search">Search</Link>
            <a href="#pricing">Pricing</a>
            <Link className="nav-cta" to={primaryCta}>
              {rootData.session ? "Open workspace" : "Create account"}
            </Link>
          </nav>
        </div>
      </header>

      <section className="hero-section">
        <div className="container hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">Analysis first. Monitoring second. Workspace where it matters.</p>
            <h1>Decode what competitors are saying, selling, and changing on Meta.</h1>
            <p className="hero-lead">
              0509 turns the Meta Ad Library into a usable analysis workspace. Search the ads,
              inspect the offer and landing page, save what matters, and track what changed next week.
            </p>
            <div className="hero-actions">
              <Link className="button button-primary" to={primaryCta}>
                {rootData.session ? "Open workspace" : "Start with email"}
              </Link>
              <Link className="button button-secondary" to="/search">
                Try the search flow
              </Link>
            </div>
            <div className="hero-samples">
              <span>Popular India-first searches:</span>
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

          <aside className="hero-preview">
            <div className="monitor-card">
              <div className="monitor-card-top">
                <span className="status-dot" />
                <p>Weekly competitor digest</p>
              </div>
              <h2>boAt switched the offer, Meesho switched the destination.</h2>
              <ul className="event-list compact-list">
                <li>
                  <strong>boAt</strong>
                  <span>Launch pricing with COD available</span>
                </li>
                <li>
                  <strong>Meesho</strong>
                  <span>Seller acquisition creative now routes to WhatsApp.</span>
                </li>
                <li>
                  <strong>Nykaa</strong>
                  <span>Headline changed from “sale” to “curated festive bundles”.</span>
                </li>
              </ul>
            </div>
            <div className="metric-row">
              <article className="metric-card">
                <span>Hook</span>
                <strong>Pain relief before ingredients</strong>
              </article>
              <article className="metric-card">
                <span>Offer</span>
                <strong>COD + bundle + free shipping</strong>
              </article>
              <article className="metric-card">
                <span>Landing page</span>
                <strong>Headline tracked with provenance</strong>
              </article>
            </div>
          </aside>
        </div>
      </section>

      <section className="comparison-section">
        <div className="container section-grid two-column">
          <article className="content-card">
            <p className="section-label">Why now</p>
            <h2>Search is commodity. Structured understanding is the product.</h2>
            <p>
              Most teams still open the Ad Library, take screenshots, paste them in WhatsApp,
              and repeat the exact same research next week. 0509 is built around the part that
              compounds: structured analysis, watchlist history, and reusable team memory.
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
          <h2 className="section-heading">Search. Inspect. Save. Track. Share.</h2>
          <div className="feature-grid">
            <article className="feature-card">
              <span className="feature-number">01</span>
              <h3>Search by advertiser or keyword</h3>
              <p>
                Start with a brand, a hook, or a market phrase like “COD” or “free shipping”.
                Filters stay normalized so saved searches and watchlists stay dedupable.
              </p>
            </article>
            <article className="feature-card">
              <span className="feature-number">02</span>
              <h3>Inspect the ad like an analyst</h3>
              <p>
                Every result carries structured fields for hook, offer, CTA, format, language,
                destination, and landing-page headline provenance.
              </p>
            </article>
            <article className="feature-card">
              <span className="feature-number">03</span>
              <h3>Track the changes that matter</h3>
              <p>
                Watchlists keep a real run history, detect new or inactive ads, and capture landing-page
                changes for weekly digests and live summaries.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="workspace-section">
        <div className="container section-grid two-column">
          <article className="content-card">
            <p className="section-label">The hook</p>
            <h2>0509 helps growth teams decode what competitors are saying, selling, and changing on Meta.</h2>
            <p>
              Public hook: analysis. Retention loop: monitoring. Surface area: a lightweight
              workspace with collections, notes, exports, and share links.
            </p>
          </article>
          <article className="content-card">
            <p className="section-label">The real business</p>
            <ul className="bullet-list">
              <li>Time saved replacing repeated manual research.</li>
              <li>Visibility into changing offers, hooks, and landing pages.</li>
              <li>A shared memory layer that survives the next sprint or client handoff.</li>
            </ul>
          </article>
        </div>
      </section>

      <section className="pricing-section" id="pricing">
        <div className="container">
          <div className="pricing-header">
            <div>
              <p className="section-label">Pricing</p>
              <h2 className="section-heading">India-first product, region-aware pricing.</h2>
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
            {PRICING_COPY[rootData.pricingRegion].currency}.
          </p>

          <div className="pricing-grid">
            {rootData.pricingPlans.map((plan) => (
              <article className="pricing-card" key={plan.name}>
                <p className="eyebrow">{plan.name}</p>
                <h3>{plan.monthlyLabel}</h3>
                <p className="muted-text">{plan.yearlyLabel}</p>
                <p>{plan.detail}</p>
                {rootData.session ? (
                  <Form action="/api/checkout" method="post">
                    <input name="plan" type="hidden" value={plan.name.toLowerCase()} />
                    <input name="interval" type="hidden" value="monthly" />
                    <button className="button button-primary" type="submit">
                      Upgrade to {plan.name}
                    </button>
                  </Form>
                ) : (
                  <Link className="button button-primary" to={primaryCta}>
                    Start with email
                  </Link>
                )}
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
