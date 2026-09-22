import type { ReactNode } from "react";

const CLOCK = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const DAY_NAME = new Intl.DateTimeFormat("en-GB", { weekday: "long" });

const BARE_SENTENCES = new Set(["no data", "nothing here"]);

export type EmptyStateAction =
  | { kind: "link"; label: string; href: string }
  | { kind: "input"; label: string; placeholder: string; name: string };

export interface EmptyStateProps {
  sentence: string;
  action?: EmptyStateAction | undefined;
}

export function EmptyState({ sentence, action }: EmptyStateProps) {
  const bare = bareSentence(sentence);
  if (BARE_SENTENCES.has(bare)) {
    throw new Error(
      `empty-state: ${JSON.stringify(sentence)} renders no truth. DESIGN.md 7. Every empty surface says what will fill it and when, or carries the one action that fills it.`,
    );
  }

  return (
    <div className="border-line border p-4">
      <p className="max-w-prose text-[0.88rem] leading-[1.5]">{sentence}</p>
      {action ? <Action action={action} /> : null}
    </div>
  );
}

function Action({ action }: { action: EmptyStateAction }): ReactNode {
  if (action.kind === "input") {
    return (
      <label className="mt-3 flex items-center gap-3">
        <span className="font-display text-[1.02rem] uppercase">{action.label}</span>
        <input
          className="border-line min-w-0 flex-1 border px-3 py-2 text-[0.88rem]"
          name={action.name}
          placeholder={action.placeholder}
          aria-label={action.label}
        />
      </label>
    );
  }
  return (
    <a className="font-display mt-3 inline-block text-[1.02rem] uppercase" href={href(action.href)}>
      {action.label}
    </a>
  );
}

function href(target: string): string {
  if (!target.startsWith("/") || target.startsWith("//")) {
    throw new Error(`empty-state: an action href must be a same-site path, got ${JSON.stringify(target)}`);
  }
  return target;
}

function bareSentence(sentence: string): string {
  return sentence
    .replace(/^\s+|\s+$/g, "")
    .replace(/[.!?—–-]+$/g, "")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .trim()
    .toLowerCase();
}

export interface HomeSecondZero {
  sentence: string;
  action: EmptyStateAction;
}

export function homeSecondZero(now: Date): HomeSecondZero {
  const firstRead = shift(now, 1);
  const brief = shift(now, 6);
  return {
    sentence: `We're gathering the first week. Your first read-this-first lands by ${clock(firstRead)} today; the brief comes ${weekday(brief)} ${clock(brief)}.`,
    action: { kind: "link", label: "Add a competitor", href: "/app/competitors" },
  };
}

export interface QuietWeek {
  sentence: string;
  action: EmptyStateAction;
}

export function quietWeek(mentions: number, siteChanges: number, adsChecked: number): QuietWeek {
  return {
    sentence: `Quiet week. ${String(mentions)} mentions, ${String(siteChanges)} site changes and ${String(adsChecked)} new ads checked — nothing crossed the bar.`,
    action: { kind: "link", label: "Open the counts", href: "/app" },
  };
}

export function fewerThanTwoOnBrands(): { sentence: string; action: EmptyStateAction } {
  return {
    sentence: "Add a competitor to see where you stand.",
    action: {
      kind: "input",
      label: "Add a competitor",
      placeholder: "their site, or a handle",
      name: "competitor",
    },
  };
}

export function evidenceEmpty(paths: readonly string[], lastCheckedAt: Date): { sentence: string } {
  return {
    sentence: `No site changes this week. We checked ${paths.join(" and ")} daily — last at ${clock(lastCheckedAt)}.`,
  };
}

export function competitorJustAdded(): { sentence: string } {
  return {
    sentence:
      "Watching from today. The first ads and mentions land within the hour; site changes need a second snapshot, so the first mark comes tomorrow.",
  };
}

export function alertsEmpty(): { sentence: string } {
  return {
    sentence:
      "Nothing has interrupted you. When your own site breaks you'll get an email; everything else waits here.",
  };
}

export function degradedSource(source: string, since: string): { sentence: string } {
  return {
    sentence: `${source} has been ${since}. We show it as degraded rather than pretend the count is complete.`,
  };
}

const DAY_MS = 86_400_000;

function shift(now: Date, days: number): Date {
  return new Date(now.getTime() + days * DAY_MS);
}

function clock(at: Date): string {
  return CLOCK.format(at);
}

function weekday(at: Date): string {
  return DAY_NAME.format(at);
}
