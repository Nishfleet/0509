import type { SearchAnswer, SearchStealSummary } from "~/lib/search-answer";

export function SearchAnswerPanel({
  answer,
  steal = null,
}: {
  answer: SearchAnswer;
  steal?: SearchStealSummary | null;
}) {
  return (
    <section
      aria-label="Search answer"
      aria-live="polite"
      className={`f9-search-answer is-${answer.state}`}
      role="status"
    >
      <div>
        <span>Search answer</span>
        <h3>{answer.title}</h3>
        <p>{answer.summary}</p>
      </div>
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
    </section>
  );
}
