import type { ReactElement, ReactNode } from "react";
import { Link } from "react-router";

import { adLibraryLinks } from "../lib/competitor/ad-library-links";
import { pausedReasonLine } from "../lib/competitor/reason-customer";
import { DAY_MONTH, dayMonthLabel } from "./brand-switch";

export { dayMonthLabel };

export function competitorPausedLine(stateChangedAt: string | null, stateReason: string | null = null): string {
  const pausedDate = stateChangedAt === null ? null : new Date(stateChangedAt);
  const base =
    pausedDate === null || Number.isNaN(pausedDate.getTime()) ? "Paused" : `Paused ${DAY_MONTH.format(pausedDate)}`;
  const why = pausedReasonLine(stateReason);
  return why === undefined ? base : `${base} · ${why}`;
}

const AD_LINK =
  "inline-flex min-h-11 items-center text-ink-soft underline decoration-1 underline-offset-4 hover:text-ink";

function AdLibraryLinks({ name, domain }: { name: string; domain: string }): ReactElement {
  const links = adLibraryLinks({ name, domain });
  return (
    <p data-slot="competitor-ad-links" className="flex flex-wrap gap-x-4 text-body-sm">
      <a
        href={links.meta}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${name}'s ads on Meta (opens in a new tab)`}
        className={AD_LINK}
      >
        Their ads on Meta
      </a>
      <a
        href={links.google}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${name}'s ads on Google (opens in a new tab)`}
        className={AD_LINK}
      >
        Their ads on Google
      </a>
    </p>
  );
}

export interface CompetitorHeaderProps {
  name: string;
  domain: string;
  state: "on" | "off";
  stateChangedAt: string | null;
  stateReason?: string | null;
  control?: ReactNode;
}

export function CompetitorHeader({
  name,
  domain,
  state,
  stateChangedAt,
  stateReason = null,
  control,
}: CompetitorHeaderProps): ReactElement {
  return (
    <header data-slot="competitor-header" className="flex min-w-0 flex-col gap-3">
      <nav aria-label="Breadcrumb" className="flex items-center font-mono text-meta text-ink-soft uppercase">
        <Link
          to="/app/competitors"
          prefetch="intent"
          className="inline-flex min-h-11 items-center underline decoration-1 underline-offset-4"
        >
          Competitors
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{name}</span>
      </nav>
      <div
        data-slot="competitor-identity"
        className="flex min-w-0 flex-wrap items-start justify-between gap-x-6 gap-y-3"
      >
        <div className="min-w-0">
          <h1 className="font-display text-display-2 font-extrabold break-words uppercase">{name}</h1>
          <p className="text-body-sm [overflow-wrap:anywhere] text-ink-soft">{domain}</p>
          <AdLibraryLinks name={name} domain={domain} />
          {state === "off" ? (
            <p data-slot="competitor-paused" className="font-mono text-meta text-ink-soft uppercase">
              {competitorPausedLine(stateChangedAt, stateReason)}
            </p>
          ) : null}
        </div>
        {control}
      </div>
    </header>
  );
}
