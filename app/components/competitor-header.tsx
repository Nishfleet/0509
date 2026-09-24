import type { ReactElement, ReactNode } from "react";
import { Link } from "react-router";

import { competitorReasonFragment } from "../lib/competitor-reason";
import { BrandSwitch, DAY_MONTH } from "./brand-switch";

export { DAY_MONTH };

export function competitorPausedLine(
  stateChangedAt: string | null,
  stateReason: string | null = null,
): string {
  const base = stateChangedAt === null ? "Paused" : `Paused ${DAY_MONTH.format(new Date(stateChangedAt))}`;
  if (stateReason === null) return base;
  const why = competitorReasonFragment(stateReason);
  return why === undefined ? base : `${base} · ${why}`;
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
              {competitorPausedLine(stateChangedAt, stateReason)}
            </p>
          ) : null}
        </div>
        {control}
      </div>
    </header>
  );
}

const CONSEQUENCE =
  "Off stops the watching and the alerts. The history stays, and turning it back on picks up where it left off.";

export function CompetitorSwitch({
  state,
  brandName,
  onCheckedChange,
}: {
  state: "on" | "off";
  brandName: string;
  onCheckedChange?: (checked: boolean) => void;
}): ReactElement {
  return (
    <div data-slot="competitor-switch" className="flex min-w-0 max-w-[26rem] items-center gap-3">
      <BrandSwitch state={state} brandName={brandName} onCheckedChange={onCheckedChange} />
      <p className="min-w-0 text-body-sm text-ink-soft">{CONSEQUENCE}</p>
    </div>
  );
}
