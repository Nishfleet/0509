import type { ReactElement } from "react";

import type { FeedItem } from "../lib/site/alerts-feed";
import { markTitle, shotPath } from "../lib/site/alerts-feed";
import { shortUtc } from "../lib/short-utc";

const GRID = "grid gap-4 min-[860px]:grid-cols-2";
const CARD = "border-line border p-3";
const SUMMARY_CLASS = "mt-2 leading-[1.65] [overflow-wrap:anywhere]";
const WHEN_CLASS = "text-ink-soft mt-2 block font-mono text-meta uppercase";

export function BeforeAfterMark({ item }: { item: FeedItem }): ReactElement {
  return (
    <article data-testid="before-after-mark" className="border-line mt-8 border-t pt-6">
      <h3 className="font-display text-row-name font-bold [overflow-wrap:anywhere]">{markTitle(item)}</h3>
      <div className={GRID}>
        <Figure side="before" hasShot={item.hasBefore} signalId={item.signalId} />
        <Figure side="after" hasShot={item.hasAfter} signalId={item.signalId} />
      </div>
      <p className={SUMMARY_CLASS}>{item.summary}</p>
      <a className="text-ink-soft mt-1 inline-block font-mono text-meta underline" href={item.url}>
        {item.url}
      </a>
      <time dateTime={item.observedAt} className={WHEN_CLASS}>
        {shortUtc(item.observedAt)}
      </time>
    </article>
  );
}

function Figure({
  side,
  hasShot,
  signalId,
}: {
  side: "before" | "after";
  hasShot: boolean;
  signalId: string;
}): ReactElement {
  const src = shotPath(signalId, side);
  return (
    <figure className={CARD}>
      <figcaption className="font-mono text-[0.7rem] uppercase text-ink-soft">
        {side === "before" ? "Before" : "After"}
      </figcaption>
      {hasShot ? (
        <img
          alt={side === "before" ? "Before" : "After"}
          className="mt-2 block size-full max-h-[420px] object-cover object-top"
          data-slot={`${side}-shot`}
          loading="lazy"
          src={src}
        />
      ) : (
        <p data-slot={`${side}-missing`} className="mt-2 font-mono text-meta text-ink-soft">
          Screenshot unavailable
        </p>
      )}
    </figure>
  );
}
