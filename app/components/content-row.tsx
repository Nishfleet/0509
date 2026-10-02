import type { ReactElement } from "react";

const WHEN_CLASS = "mt-2 block font-mono text-meta text-ink-soft uppercase";
const TITLE = "font-display text-row-name font-bold [overflow-wrap:anywhere]";
const LINK = "inline-flex min-h-11 items-center underline decoration-1 underline-offset-4";

export interface ContentAlertItem {
  id: string;
  title: string;
  brand: string;
  excerpt: string | null;
  url: string;
  at: string;
  when: string;
}

export function ContentRow({ content }: { content: ContentAlertItem }): ReactElement {
  return (
    <article id={content.id} data-testid="content-row" className="mt-8 border-t border-line pt-6">
      <h3 className={TITLE}>
        <a href={content.url} rel="noopener noreferrer nofollow" target="_blank" className={LINK}>
          {content.title}
        </a>
      </h3>
      <p className="mt-2 leading-[1.65]">{content.brand} published a new post</p>
      {content.excerpt === null ? null : <p className="mt-2 leading-[1.65] text-ink-soft">{content.excerpt}</p>}
      <time dateTime={content.at} className={WHEN_CLASS}>
        {content.when}
      </time>
    </article>
  );
}
