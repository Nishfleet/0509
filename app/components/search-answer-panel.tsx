import type { SearchAnswer } from "~/lib/search-answer";

export function SearchAnswerPanel({ answer }: { answer: SearchAnswer }) {
  return (
    <section className={`f9-search-answer is-${answer.state}`} aria-label="Search answer">
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
      {answer.note ? <p className="f9-search-answer-note">{answer.note}</p> : null}
    </section>
  );
}
