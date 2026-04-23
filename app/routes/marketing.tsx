import { Form, Link, useRouteLoaderData } from "react-router";
import type { MetaFunction } from "react-router";

import { sampleQueries } from "~/lib/demo-data";
import { PRICING_COPY } from "~/lib/pricing";
import type { RootLoaderData } from "~/root";

export const meta: MetaFunction = () => [
  { title: "Five to Nine | See what changed, with proof" },
  {
    name: "description",
    content:
      "Five to Nine helps growth teams catch competitor changes on Meta before the next workday, verify them with proof, and receive trusted alerts by email and WhatsApp.",
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
              <small>Proof-backed competitor monitoring</small>
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
            <p className="eyebrow">See what changed, with proof.</p>
            <h1>See what changed before your next standup.</h1>
            <p className="hero-lead">
              Five to Nine closes the gap between when your team stops checking and when the next decision gets made.
              It watches competitor ads and landing pages on Meta, confirms the real changes, and sends proof-backed
              alerts by email and WhatsApp.
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
                <p>Proof-backed change alert</p>
              </div>
              <h2>boAt changed the offer. Meesho changed the destination.</h2>
              <ul className="event-list compact-list">
                <li>
                  <strong>boAt</strong>
                  <span>Offer moved from ₹499 to ₹799 with COD still visible.</span>
                </li>
                <li>
                  <strong>Meesho</strong>
                  <span>Ad now routes to a different landing page.</span>
                </li>
                <li>
                  <strong>Nykaa</strong>
                  <span>Headline changed from “sale” to “curated festive bundles”.</span>
                </li>
              </ul>
            </div>
            <div className="metric-row">
              <article className="metric-card">
                <span>Proof</span>
                <strong>Screenshot + HTML + extracted fields</strong>
              </article>
              <article className="metric-card">
                <span>Delivery</span>
                <strong>Email + WhatsApp from day one</strong>
              </article>
              <article className="metric-card">
                <span>Ranking</span>
                <strong>India-aware signal scoring</strong>
              </article>
            </div>
          </aside>
        </div>
      </section>

      <section className="comparison-section">
        <div className="container section-grid two-column">
          <article className="content-card">
            <p className="section-label">Why now</p>
            <h2>Most teams do competitor research. They still find changes too late.</h2>
            <p>
              Between end-of-day and the next standup, competitors launch new ads, change offers,
              and swap landing pages. Five to Nine is built for that gap: cheap monitoring,
              selective proof, and alerts teams can trust.
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
          <h2 className="section-heading">Search. Watch. Prove. Deliver.</h2>
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
              <h3>Deliver only the changes worth interrupting for</h3>
              <p>
                Watchlists keep a real run history, confirm meaningful changes, and push the right ones
                into email and WhatsApp with clear confidence.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="workspace-section">
        <div className="container section-grid two-column">
          <article className="content-card">
            <p className="section-label">The hook</p>
            <h2>Five to Nine tells growth teams what changed, proves it, and shows what got sent.</h2>
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
                  <Link className="button button-primary" to={primaryCta}>
                    Open workspace
                  </Link>
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
