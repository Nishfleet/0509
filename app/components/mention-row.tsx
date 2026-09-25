import type { ReactElement } from "react";

import { POSSIBLY_LINE, type MentionRowModel } from "../lib/mention-feed";

const WHEN_CLASS = "text-ink-soft mt-2 block font-mono text-meta uppercase";
const TITLE = "font-display text-lg font-semibold [overflow-wrap:anywhere]";
const LINK = "underline decoration-1 underline-offset-4";
const PILL =
  "border-line text-ink-soft inline-flex max-w-full border px-2 py-1 font-mono text-pill uppercase [overflow-wrap:anywhere]";

export function MentionRow({ mention }: { mention: MentionRowModel }): ReactElement {
  const card = mention.treatment === "shown";
  return (
    <article
      id={mention.id}
      data-testid="mention-row"
      data-treatment={mention.treatment}
      className={card ? "border-line bg-card mt-8 min-w-0 border-t pt-6" : "bg-bone mt-8 min-w-0 py-6"}
    >
      <h3 className={TITLE}>
        <a href={mention.url} rel="noopener noreferrer nofollow" target="_blank" className={LINK}>
          {mention.title}
        </a>
      </h3>
      {mention.treatment === "possibly" ? <p className="mt-2 leading-[1.65]">{POSSIBLY_LINE}</p> : null}
      <p className="mt-2 flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <span data-testid="mention-source" className={PILL}>
          {mention.sourceName}
        </span>
        <time dateTime={mention.publishedAt ?? mention.observedAt} className={WHEN_CLASS}>
          {mention.when}
        </time>
      </p>
      <details className="mt-3 min-w-0">
        <summary className="cursor-pointer font-mono text-meta underline decoration-1 underline-offset-4">
          Why we flagged this
        </summary>
        {mention.why === null ? null : (
          <p data-testid="mention-why" className="mt-2 leading-[1.65] [overflow-wrap:anywhere]">
            {mention.why}
          </p>
        )}
      </details>
    </article>
  );
}
