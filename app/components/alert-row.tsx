import type { ReactElement } from "react";

import type { BriefPayload } from "../lib/brief-payload";
import type { MentionRowModel } from "../lib/mention-feed";
import { BriefView } from "./brief-view";
import { MentionRow } from "./mention-row";
import { SiteChangeItem, type SiteChangeItemData } from "./site-change-item";
import { buttonVariants } from "./ui/button";

const WHEN_CLASS = "text-ink-soft mt-2 block font-mono text-meta uppercase";

const CARD = "border-line mt-8 border-t pt-6";
const TITLE = "font-display text-row-name font-bold [overflow-wrap:anywhere]";
const BODY = "mt-2 leading-[1.65]";
const DETAILS = "mt-4";
const SUMMARY = "cursor-pointer underline decoration-1 underline-offset-4";
const READ_BRIEF = buttonVariants({ variant: "tertiary", className: "cursor-pointer" });
const BRIEF = "mt-4";

export interface TakedownNoteItem {
  id: string;
  title: string;
  created_at: string;
  when: string;
}

export interface DeliveryFailureItem {
  id: string;
  title: string;
  body: string | null;
  created_at: string;
  when: string;
  digest_id: string | null;
  brief: BriefPayload | null;
}

export interface SignalAlertItem {
  id: string;
  title: string;
  body: string | null;
  url: string | null;
  created_at: string;
  when: string;
}

export type AlertFeedItem =
  | { kind: "change"; id: string; at: string; change: SiteChangeItemData }
  | { kind: "note"; id: string; at: string; note: TakedownNoteItem }
  | { kind: "failure"; id: string; at: string; failure: DeliveryFailureItem }
  | { kind: "signal"; id: string; at: string; signal: SignalAlertItem }
  | { kind: "mention"; id: string; at: string; mention: MentionRowModel };

export function AlertFeedRow({ item, eager }: { item: AlertFeedItem; eager: boolean }): ReactElement {
  if (item.kind === "change") {
    return <SiteChangeItem change={item.change} eager={eager} />;
  }

  if (item.kind === "note") {
    return (
      <article id={item.note.id} data-testid="takedown-note" className={CARD}>
        <h3 className={TITLE}>{item.note.title}</h3>
        <time dateTime={item.note.created_at} className={WHEN_CLASS}>
          {item.note.when}
        </time>
      </article>
    );
  }

  if (item.kind === "mention") {
    return <MentionRow mention={item.mention} />;
  }

  if (item.kind === "signal") {
    return (
      <article id={item.signal.id} data-testid="signal-alert" className={CARD}>
        <h3 className={TITLE}>
          {item.signal.url === null ? (
            item.signal.title
          ) : (
            <a href={item.signal.url} rel="noopener noreferrer nofollow" target="_blank" className={SUMMARY}>
              {item.signal.title}
            </a>
          )}
        </h3>
        {item.signal.body === null ? null : <p className={BODY}>{item.signal.body}</p>}
        <time dateTime={item.signal.created_at} className={WHEN_CLASS}>
          {item.signal.when}
        </time>
      </article>
    );
  }

  return (
    <article id={item.failure.id} data-testid="delivery-failure" className={CARD}>
      <h3 className={TITLE}>{item.failure.title}</h3>
      <p className={BODY}>{item.failure.body}</p>
      <time dateTime={item.failure.created_at} className={WHEN_CLASS}>
        {item.failure.when}
      </time>
      {item.failure.brief === null ? null : (
        <details className={DETAILS}>
          <summary className={READ_BRIEF}>Read the brief</summary>
          <div className={BRIEF}>
            <BriefView payload={item.failure.brief} />
          </div>
        </details>
      )}
      {item.failure.digest_id === null ? null : (
        <p className={BODY}>
          <a className={SUMMARY} href={`/app/brief/${item.failure.digest_id}`}>
            Open it with your past briefs
          </a>
        </p>
      )}
    </article>
  );
}
