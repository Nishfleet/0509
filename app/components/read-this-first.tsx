import type { HomeRead } from "../../workers/standing/present";

export function ReadThisFirst({ items }: { items: HomeRead[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-label="Read this first">
      <h2>Read this first</h2>
      <ol>
        {items.map((item) => (
          <li key={item.signalId}>
            <p>{item.reason ?? item.title}</p>
            {item.evidenceUrl ? <img src={item.evidenceUrl} alt="" width={320} height={180} /> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
