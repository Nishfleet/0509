import { Link } from "react-router";

import { LocalTime } from "~/components/local-time";
import type { SignupFirstBriefLoaderData } from "~/lib/first-brief";

/**
 * BET 7 (issue #1276): the inline first-brief surface rendered at
 * `/app/onboard?step=first-brief`. Shows the captured headline, CTA, price,
 * screenshot evidence link, and the deterministic "what changed" sentence.
 * No LLM text on this surface — every line is derived from the filed digest
 * and the ad record.
 *
 * The waiting state renders when the activation scan is still in flight; the
 * ready state renders the brief once evidence is linked.
 */
export function SignupFirstBriefView({
  data,
}: {
  data: SignupFirstBriefLoaderData;
}) {
  if (data.status === "no_ads") {
    return (
      <article
        className="f9-wk-brief f9-signup-first-brief"
        id="signup-first-brief"
      >
        <header className="f9-wk-brief-head">
          <h1>
            No verified ads yet
            {data.watchlistName ? ` — ${data.watchlistName}` : ""}
          </h1>
        </header>
        <section className="f9-signup-first-brief-body">
          <p>
            The activation scan ran and found no verified ads we could point
            you to right now. Sometimes a competitor only advertises on some
            platforms, or their ads aren't publicly linkable yet.
          </p>
        </section>

        {/* Issue #2411: the terminal state used to end on a generic "Add
            competitors" link and a promise to email later (for free, the
            following Monday). Both blocks below give the first session
            something real instead: brands we already track whose public ad
            history is already on screen, and a route to capture a page for the
            competitor the user already has. Neither invents a claim — the
            brand links come from the same indexable set the /brands hub
            serves, and the capture offer names only what the plan already
            includes. */}
        {data.suggestedBrands.length > 0 ? (
          <section className="f9-signup-first-brief-body">
            <h2 className="f9-wk-kick">Brands we already track</h2>
            <p>
              Their public ad history is already on screen, so you can look
              around without waiting on a scan:{" "}
              {data.suggestedBrands.map((brand, index) => (
                <span key={brand.domain}>
                  {index > 0 ? " · " : null}
                  <Link to={brand.path}>{brand.name}</Link>
                </span>
              ))}
            </p>
          </section>
        ) : null}

        <section className="f9-signup-first-brief-body">
          <h2 className="f9-wk-kick">Add a page to capture instead</h2>
          <p>
            {data.watchlistName ?? "Your competitor"} is already being watched.
            Open it and point us at a product or promotion page it runs, and
            the next check covers that page too — using the competitor you
            already have, no second competitor needed.
          </p>
          <Link
            to={
              data.watchlistId
                ? `/app/watchlists/${encodeURIComponent(data.watchlistId)}`
                : "/app/watchlists"
            }
            className="f9-wk-btn"
          >
            Open {data.watchlistName ?? "your competitor"}
          </Link>
        </section>

        <footer className="f9-signup-first-brief-footer">
          <p>
            We'll keep watching and alert you when a verified ad appears.
          </p>
          <Link to="/app" className="f9-wk-btn">
            Add competitors
          </Link>
        </footer>
      </article>
    );
  }

  if (data.status === "waiting") {
    return (
      <article className="f9-wk-brief f9-signup-first-brief" id="signup-first-brief">
        <header className="f9-wk-brief-head">
          <h1>Your first brief is being captured</h1>
          <p className="f9-wk-brief-meta">
            {data.watchlistName
              ? `We're scanning ${data.watchlistName} now.`
              : "We're scanning your competitor now."}
          </p>
        </header>
        <div className="f9-signup-first-brief-waiting">
          <p>
            The activation scan takes a few minutes. We'll show your baseline
            brief here as soon as it's ready, and email it to you within the hour.
          </p>
          <Link to="/app" className="f9-wk-btn">
            Go to your dashboard
          </Link>
        </div>
      </article>
    );
  }

  const brief = data.brief;
  return (
    <article className="f9-wk-brief f9-signup-first-brief" id="signup-first-brief">
      <header className="f9-wk-brief-head">
        <h1>Your first brief: {brief.watchlistName}</h1>
        <p className="f9-wk-brief-meta">
          {brief.screenshotDate ? (
            <LocalTime iso={brief.screenshotDate} mode="date" />
          ) : null}
        </p>
      </header>

      <section className="f9-signup-first-brief-body">
        {brief.headline ? (
          <p className="f9-signup-first-brief-headline">{brief.headline}</p>
        ) : null}

        <dl className="f9-signup-first-brief-fields">
          {brief.cta ? (
            <div className="f9-signup-first-brief-field">
              <dt>Call to action</dt>
              <dd>{brief.cta}</dd>
            </div>
          ) : null}
          {brief.price ? (
            <div className="f9-signup-first-brief-field">
              <dt>Offer / price</dt>
              <dd>{brief.price}</dd>
            </div>
          ) : null}
        </dl>

        <p className="f9-signup-first-brief-what-changed">
          {brief.whatChanged}
        </p>

        {brief.evidenceUrl ? (
          <p className="f9-signup-first-brief-evidence">
            <a
              href={brief.evidenceUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              View the screenshot evidence
            </a>
          </p>
        ) : null}
      </section>

      <footer className="f9-signup-first-brief-footer">
        <p>
          {/* Issue #2407: only claim the email after the
              `activation-result:<user>:<watchlist>` delivery attempt reached
              `sent`. The dispatch failure is swallowed in the scan path, so
              "we've emailed this brief to you" was previously rendered even
              when no email left the building. */}
          {data.activationEmailSent
            ? "We've emailed this brief to you."
            : "Your brief is ready — the email is on its way."}{" "}
          Future alerts only cover real changes — you'll hear from us when{" "}
          {brief.watchlistName} moves.
        </p>
        <Link to="/app" className="f9-wk-btn">
          Go to your dashboard
        </Link>
      </footer>
    </article>
  );
}
