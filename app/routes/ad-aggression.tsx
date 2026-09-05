import { Link, useLocation } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { PublicDocBlock, PublicDocShell } from "~/components/public-doc-shell";
import { Breadcrumbs } from "~/components/breadcrumbs";
import {
  AD_AGGRESSION_METHODOLOGY_PATH,
  AGGRESSION_FORMULA_VERSION,
  AGGRESSION_FRESHNESS_DAYS,
  AGGRESSION_PERSISTENCE_DAYS,
  AGGRESSION_TESTING_SATURATION_SHARE,
  MIN_AGGRESSION_WINDOW_DAYS,
  linearShareCurvePoints,
  publicAggressionBands,
  testingCurvePoints,
  velocityCurvePoints,
} from "~/lib/aggression-score";
import {
  canonicalLinks,
  faqPageJsonLd,
  jsonLdScriptProps,
  publicSeoMeta,
  webPageJsonLd,
  type FaqJsonLdEntry,
} from "~/lib/seo";
import { localeSearchPathname } from "~/lib/locale-markets";

const pageTitle = "Ad Aggression Score methodology | Five to Nine";
const pageDescription =
  "How Five to Nine computes the Ad Aggression Score: four public parts — Velocity, Testing, Freshness, Persistence — that add up to 0–100, with no hidden weighting.";

const testingSaturationPercent = Math.round(AGGRESSION_TESTING_SATURATION_SHARE * 100);
const bands = publicAggressionBands();

export const adAggressionMethodologyFaqEntries: ReadonlyArray<FaqJsonLdEntry> = [
  {
    question: "What is the Ad Aggression Score?",
    answer:
      "A 0–100 read of how hard a competitor is pushing their Meta ad program in the observed window. It is made of four parts worth 0–25 each: Velocity, Testing, Freshness, and Persistence. The four parts always add up to the displayed score.",
  },
  {
    question: "How is the Ad Aggression Score calculated?",
    answer: `Each part uses a published curve. Velocity scores new ads per week. Testing scores the share of ads with more than one creative variant, saturating at ${testingSaturationPercent}%. Freshness scores the share of active ads first seen in the last ${AGGRESSION_FRESHNESS_DAYS} days. Persistence scores the share of ads running or tracked for ${AGGRESSION_PERSISTENCE_DAYS}+ days. Each part is rounded to a whole point before they are added.`,
  },
  {
    question: "Why does a brand have no Ad Aggression Score?",
    answer: `A score needs at least ${MIN_AGGRESSION_WINDOW_DAYS} days of observed history. Below that, the page states that there is not enough history — it never invents a number on thin evidence.`,
  },
  {
    question: "Does a high score mean the brand is spending more?",
    answer:
      "No. The score does not measure spend, impressions, reach, or Meta's own metrics. It only uses what is visible in the public Meta Ad Library capture: how often new ads appear, how much variant testing is running, how fresh the active set is, and how long ads stay in rotation.",
  },
] as const;

export const links: LinksFunction = () => canonicalLinks(AD_AGGRESSION_METHODOLOGY_PATH);

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: pageTitle,
    description: pageDescription,
    pathname: AD_AGGRESSION_METHODOLOGY_PATH,
  });

export default function AdAggressionMethodologyRoute() {
  const structuredFaq = faqPageJsonLd(adAggressionMethodologyFaqEntries);
  // Funnel the localised visitor's search moment to `/{locale}/search`, not
  // EN `/search` (issue 1578, accept #3).
  const location = useLocation();
  const searchPath = localeSearchPathname(location.pathname);

  return (
    <PublicDocShell
      kicker="Methodology"
      title="Ad Aggression Score."
      intro="A 0–100 read of how hard a competitor is pushing their Meta ads, built from four public parts. No model, no hidden weighting, and no score until there is enough history to make one fair."
    >
      <script
        {...jsonLdScriptProps(
          webPageJsonLd({
            name: pageTitle,
            description: pageDescription,
            pathname: AD_AGGRESSION_METHODOLOGY_PATH,
          }),
        )}
      />
      <script {...jsonLdScriptProps(structuredFaq)} />
      <Breadcrumbs
        items={[
          { name: "Home", pathname: "/" },
          { name: "Ad Aggression Score", pathname: AD_AGGRESSION_METHODOLOGY_PATH },
        ]}
      />

      <nav className="f9-doc-toc" aria-label="On this page">
        <span className="f9-doc-toc-label">On this page</span>
        <ul>
          <li>
            <a href="#four-parts">The four parts</a>
          </li>
          <li>
            <a href="#velocity">Velocity</a>
          </li>
          <li>
            <a href="#testing">Testing</a>
          </li>
          <li>
            <a href="#freshness">Freshness</a>
          </li>
          <li>
            <a href="#persistence">Persistence</a>
          </li>
          <li>
            <a href="#bands">Score bands</a>
          </li>
          <li>
            <a href="#evidence-floor">Evidence floor</a>
          </li>
          <li>
            <a href="#what-it-is-not">What it is not</a>
          </li>
        </ul>
      </nav>

      <PublicDocBlock id="four-parts" title="The four parts">
        <p>
          The score is formula version {AGGRESSION_FORMULA_VERSION}. Each part contributes 0–25
          points. The four displayed bars always add up exactly to the displayed total because each
          part is rounded to a whole point <em>before</em> they are summed.
        </p>
        <ul className="f9-doc-list">
          <li>
            <a href="#velocity">Velocity</a> — how fast new ads enter the capture.
          </li>
          <li>
            <a href="#testing">Testing</a> — how much of the set runs more than one creative variant.
          </li>
          <li>
            <a href="#freshness">Freshness</a> — how much of the active set is new.
          </li>
          <li>
            <a href="#persistence">Persistence</a> — how much of the set has stayed in rotation.
          </li>
        </ul>
        <p>
          You will see the number on every{" "}
          <Link to="/ads/nike.com">public brand ads page</Link> that has enough history. A live
          search of a competitor is at <Link to={searchPath}>Search</Link>.
        </p>
      </PublicDocBlock>

      <PublicDocBlock id="velocity" title="Velocity (0–25)">
        <p>
          New ads per week over the observed window. The curve is concave on purpose: going from
          nothing launching to a steady trickle says more about intent than going from a busy
          program to a slightly busier one.
        </p>
        <ul className="f9-doc-list">
          <li>{`0 ads/week → ${velocityCurvePoints(0)} points`}</li>
          <li>{`1 ad/week → ${velocityCurvePoints(1)} points`}</li>
          <li>{`3 ads/week → ${velocityCurvePoints(3)} points`}</li>
          <li>{`5 or more ads/week → ${velocityCurvePoints(5)} points (the cap)`}</li>
        </ul>
      </PublicDocBlock>

      <PublicDocBlock id="testing" title="Testing (0–25)">
        <p>
          Share of observed ads that carry more than one creative variant. Linear up to{" "}
          {testingSaturationPercent}% multi-variant, then capped — half the program under test is
          already a heavy testing posture.
        </p>
        <ul className="f9-doc-list">
          <li>{`0% multi-variant → ${testingCurvePoints(0)} points`}</li>
          <li>{`${testingSaturationPercent / 2}% multi-variant → ${testingCurvePoints(AGGRESSION_TESTING_SATURATION_SHARE / 2)} points`}</li>
          <li>{`${testingSaturationPercent}% or more → ${testingCurvePoints(AGGRESSION_TESTING_SATURATION_SHARE)} points (the cap)`}</li>
        </ul>
      </PublicDocBlock>

      <PublicDocBlock id="freshness" title="Freshness (0–25)">
        <p>
          Share of <em>active</em> ads first observed in the last {AGGRESSION_FRESHNESS_DAYS} days.
          Inactive ads do not inflate this part. Linear across the whole range — there is no early
          cap.
        </p>
        <ul className="f9-doc-list">
          <li>{`0% fresh → ${linearShareCurvePoints(0)} points`}</li>
          <li>{`50% fresh → ${linearShareCurvePoints(0.5)} points`}</li>
          <li>{`100% fresh → ${linearShareCurvePoints(1)} points`}</li>
        </ul>
      </PublicDocBlock>

      <PublicDocBlock id="persistence" title="Persistence (0–25)">
        <p>
          Share of all observed ads running or tracked for {AGGRESSION_PERSISTENCE_DAYS} days or
          more. Same linear curve as freshness. A brand can score high here and low on freshness at
          the same time — proven runners and a quiet launch week are different postures.
        </p>
        <ul className="f9-doc-list">
          <li>{`0% persistent → ${linearShareCurvePoints(0)} points`}</li>
          <li>{`50% persistent → ${linearShareCurvePoints(0.5)} points`}</li>
          <li>{`100% persistent → ${linearShareCurvePoints(1)} points`}</li>
        </ul>
      </PublicDocBlock>

      <PublicDocBlock id="bands" title="Score bands">
        <p>Inclusive upper edges. The label describes behavior in the window; it does not judge it.</p>
        <ul className="f9-doc-list">
          {bands.map((band) => (
            <li key={band.id}>
              {`${band.minScore}–${band.maxScore} ${band.label} — ${band.interpretation}`}
            </li>
          ))}
        </ul>
      </PublicDocBlock>

      <PublicDocBlock id="evidence-floor" title="Evidence floor">
        <p>
          A fair score needs at least {MIN_AGGRESSION_WINDOW_DAYS} days of observed history. Below
          that, or when the capture is still too thin to score, the brand page hides the number and
          says so. It never publishes a score on thin evidence.
        </p>
      </PublicDocBlock>

      <PublicDocBlock id="what-it-is-not" title="What it is not">
        <ul className="f9-doc-list">
          <li>Not spend, impressions, reach, or Meta&apos;s own performance metrics.</li>
          <li>Not a ranking of brands against each other. Each score is computed from that brand&apos;s own capture.</li>
          <li>
            Not coverage of every ad platform. Ad monitoring here reads the public Meta Ad Library
            only.
          </li>
          <li>
            Not a live scrape of the brand page you are reading. Those pages are cache-backed; a live
            search refreshes them.
          </li>
        </ul>
      </PublicDocBlock>
    </PublicDocShell>
  );
}
