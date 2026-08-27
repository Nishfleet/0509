import { Link } from "react-router";

import type { SearchAnswer, SearchStealSummary } from "~/lib/search-answer";

export function SearchAnswerPanel({
  answer,
  steal = null,
  showHeadline = true,
}: {
  answer: SearchAnswer;
  steal?: SearchStealSummary | null;
  /**
   * BL-031: `/search` renders `answer.title` as the results section's own
   * heading and `answer.summary` as its sub-line, so the panel would
   * otherwise state the same two sentences a second time 40px lower — the
   * "three tellings of one fact" the v2 reduction pass named. With this off
   * the panel is only what it uniquely knows: the facts, the steal summary
   * and the honest note. Callers that own no heading keep the default.
   */
  showHeadline?: boolean;
}) {
  return (
    <section
      aria-label="Search answer"
      aria-live="polite"
      className={`f9-search-answer is-${answer.state}`}
      role="status"
    >
      {showHeadline ? (
        <div>
          <span>Search answer</span>
          <h3>{answer.title}</h3>
          <p>{answer.summary}</p>
        </div>
      ) : null}
      <dl>
        {answer.facts.map((fact) => (
          <div key={`${fact.label}:${fact.value}`}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
            <small>{fact.detail}</small>
          </div>
        ))}
      </dl>
      {steal && steal.bullets.length > 0 ? (
        <div className="f9-search-answer-steal">
          <span>What to steal</span>
          <ul>
            {steal.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
          <small>AI summary of the ads above — verify before acting.</small>
        </div>
      ) : null}
      {answer.note ? <p className="f9-search-answer-note">{answer.note}</p> : null}
      {answer.nextAction ? (
        <p className="f9-search-answer-next-action">
          <Link className="f9-wk-lnk" to={answer.nextAction.href}>
            {answer.nextAction.label}
          </Link>
        </p>
      ) : null}
    </section>
  );
}
