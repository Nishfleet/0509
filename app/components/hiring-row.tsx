import type { ReactElement } from "react";

const WHEN_CLASS = "mt-2 block font-mono text-meta text-ink-soft uppercase";
const TITLE = "font-display text-row-name font-bold [overflow-wrap:anywhere]";
const LINK = "underline decoration-1 underline-offset-4";

export interface HiringAlertItem {
  id: string;
  title: string;
  brand: string;
  detail: string | null;
  url: string;
  at: string;
  when: string;
}

export function HiringRow({ hiring }: { hiring: HiringAlertItem }): ReactElement {
  return (
    <article id={hiring.id} data-testid="hiring-row" className="mt-8 border-t border-line pt-6">
      <h3 className={TITLE}>
        <a href={hiring.url} rel="noopener noreferrer nofollow" target="_blank" className={LINK}>
          {hiring.title}
        </a>
      </h3>
      <p className="mt-2 leading-[1.65]">
        {hiring.brand} is hiring{hiring.detail === null ? "" : ` · ${hiring.detail}`}
      </p>
      <time dateTime={hiring.at} className={WHEN_CLASS}>
        {hiring.when}
      </time>
    </article>
  );
}
