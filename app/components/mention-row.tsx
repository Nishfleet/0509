export interface MentionRowModel {
  id: string;
  title: string;
  canonicalUrl: string;
  publisher: string | null;
  when: string;
  andMore: string | null;
  unreviewed: boolean;
  possibly: boolean;
}

export function MentionRow({ mention }: { mention: MentionRowModel }) {
  return (
    <article>
      <h2>
        <a href={mention.canonicalUrl}>{mention.title || mention.canonicalUrl}</a>
      </h2>
      <p>
        {mention.publisher ? <span>{mention.publisher}</span> : null}{" "}
        <time>{mention.when}</time>
        {mention.possibly ? <span> possibly</span> : null}
        {mention.unreviewed ? <span> unreviewed</span> : null}
        {mention.andMore ? <span> {mention.andMore}</span> : null}
      </p>
    </article>
  );
}

export function SourcePills({
  lines,
  allDown,
}: {
  lines: { text: string; tone: "normal" | "degraded"; freshness: string | null }[];
  allDown: boolean;
}) {
  return (
    <section>
      {allDown ? <p>we&apos;re having trouble reaching our sources</p> : null}
      <ul>
        {lines.map((line) => (
          <li key={line.text} className={line.tone === "degraded" ? "text-ink-faint" : undefined}>
            {line.text}
            {line.freshness ? <span> · {line.freshness}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
