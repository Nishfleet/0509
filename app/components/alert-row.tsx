import type { ReactElement } from "react";

import type { BriefPayload } from "../lib/brief-payload";
import type { MentionRowModel } from "../lib/mention-feed";
import { BriefView } from "./brief-view";
import { ContentRow, type ContentAlertItem } from "./content-row";
import { HiringRow, type HiringAlertItem } from "./hiring-row";
import { MentionRow } from "./mention-row";
import { SiteChangeItem, type SiteChangeItemData } from "./site-change-item";
import { buttonVariants } from "./ui/button";

const WHEN_CLASS = "mt-2 block font-mono text-meta text-ink-soft uppercase";

const CARD = "mt-8 border-t border-line pt-6";
const TITLE = "font-display text-row-name font-bold [overflow-wrap:anywhere]";
const BODY = "mt-2 leading-[1.65]";
const DETAILS = "mt-4";
const SUMMARY = "inline-flex min-h-11 cursor-pointer items-center underline decoration-1 underline-offset-4";
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
  | { kind: "mention"; id: string; at: string; mention: MentionRowModel }
  | { kind: "hiring"; id: string; at: string; hiring: HiringAlertItem }
  | { kind: "content"; id: string; at: string; content: ContentAlertItem };

function TakedownNote({ note }: { note: TakedownNoteItem }): ReactElement {
  return (
    <article id={note.id} data-testid="takedown-note" className={CARD}>
      <h3 className={TITLE}>{note.title}</h3>
      <time dateTime={note.created_at} className={WHEN_CLASS}>
        {note.when}
      </time>
    </article>
  );
}

function SignalAlert({ signal }: { signal: SignalAlertItem }): ReactElement {
  return (
    <article id={signal.id} data-testid="signal-alert" className={CARD}>
      <h3 className={TITLE}>
        {signal.url === null ? (
          signal.title
        ) : (
          <a href={signal.url} rel="noopener noreferrer nofollow" target="_blank" className={SUMMARY}>
            {signal.title}
          </a>
        )}
      </h3>
      {signal.body === null ? null : <p className={BODY}>{signal.body}</p>}
      <time dateTime={signal.created_at} className={WHEN_CLASS}>
        {signal.when}
      </time>
    </article>
  );
}

function DeliveryFailure({ failure }: { failure: DeliveryFailureItem }): ReactElement {
  return (
    <article id={failure.id} data-testid="delivery-failure" className={CARD}>
      <h3 className={TITLE}>{failure.title}</h3>
      {failure.body === null ? null : <p className={BODY}>{failure.body}</p>}
      <time dateTime={failure.created_at} className={WHEN_CLASS}>
        {failure.when}
      </time>
      {failure.brief === null ? null : (
        <details className={DETAILS}>
          <summary className={READ_BRIEF}>Read the brief</summary>
          <div className={BRIEF}>
            <BriefView payload={failure.brief} />
          </div>
        </details>
      )}
      {failure.digest_id === null ? null : (
        <p className={BODY}>
          <a className={SUMMARY} href={`/app/brief/${failure.digest_id}`}>
            Open it with your past briefs
          </a>
        </p>
      )}
    </article>
  );
}

export function AlertFeedRow({ item, eager }: { item: AlertFeedItem; eager: boolean }): ReactElement {
  if (item.kind === "change") {
    return <SiteChangeItem change={item.change} eager={eager} />;
  }

  if (item.kind === "note") {
    return <TakedownNote note={item.note} />;
  }

  if (item.kind === "hiring") {
    return <HiringRow hiring={item.hiring} />;
  }

  if (item.kind === "content") {
    return <ContentRow content={item.content} />;
  }

  if (item.kind === "mention") {
    return <MentionRow mention={item.mention} />;
  }

  if (item.kind === "signal") {
    return <SignalAlert signal={item.signal} />;
  }

  return <DeliveryFailure failure={item.failure} />;
}
