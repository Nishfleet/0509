import type { ReactElement, ReactNode } from "react";
import { Link } from "react-router";

export const DAY_MONTH = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

export function competitorPausedLine(stateChangedAt: string | null): string {
  if (stateChangedAt === null) return "Paused";
  return `Paused ${DAY_MONTH.format(new Date(stateChangedAt))}`;
}

export interface CompetitorHeaderProps {
  name: string;
  domain: string;
  state: "on" | "off";
  stateChangedAt: string | null;
  control?: ReactNode;
}

export function CompetitorHeader({
  name,
  domain,
  state,
  stateChangedAt,
  control,
}: CompetitorHeaderProps): ReactElement {
  return (
    <header data-slot="competitor-header" className="flex min-w-0 flex-col gap-3">
      <nav aria-label="Breadcrumb" className="font-mono text-meta text-ink-soft uppercase">
        <Link to="/app/competitors" prefetch="intent" className="underline decoration-1 underline-offset-4">
          Competitors
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{name}</span>
      </nav>
      <div
        data-slot="competitor-identity"
        className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-3"
      >
        <div className="min-w-0">
          <h1 className="font-display text-display-2 font-extrabold break-words uppercase">{name}</h1>
          <p className="text-body-sm text-ink-soft [overflow-wrap:anywhere]">{domain}</p>
          {state === "off" ? (
            <p data-slot="competitor-paused" className="text-meta text-ink-soft font-mono uppercase">
              {competitorPausedLine(stateChangedAt)}
            </p>
          ) : null}
        </div>
        {control}
      </div>
    </header>
  );
}
