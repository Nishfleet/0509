import { Link } from "react-router";

import { LocalTime } from "~/components/local-time";
import type { SignupFirstBriefPayload } from "~/lib/first-brief";

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
  data:
    | { step: "first-brief"; status: "waiting"; watchlistName: string | null }
    | { step: "first-brief"; status: "no_ads"; watchlistName: string | null }
    | { step: "first-brief"; status: "ready"; brief: SignupFirstBriefPayload };
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
          <p>
            When {data.watchlistName ?? "this competitor"} starts running
            publicly verifiable ads, we'll capture it and email you the first
            brief. You can also add more competitors in the meantime.
          </p>
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
          We've emailed this brief to you. Future alerts only cover real
          changes — you'll hear from us when {brief.watchlistName} moves.
        </p>
        <Link to="/app" className="f9-wk-btn">
          Go to your dashboard
        </Link>
      </footer>
    </article>
  );
}
