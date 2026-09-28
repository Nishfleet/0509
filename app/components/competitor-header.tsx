import type { ReactElement, ReactNode } from "react";
import { Link } from "react-router";

import { adLibraryLinks } from "../lib/competitor/ad-library-links";
import { pausedReasonLine } from "../lib/competitor/reason-customer";
import { BrandSwitch, DAY_MONTH } from "./brand-switch";

export { DAY_MONTH };

export function competitorPausedLine(
  stateChangedAt: string | null,
  stateReason: string | null = null,
): string {
  const base =
    stateChangedAt === null ? "Paused" : `Paused ${DAY_MONTH.format(new Date(stateChangedAt))}`;
  const why = pausedReasonLine(stateReason);
  return why === undefined ? base : `${base} · ${why}`;
}

const AD_LIBRARY_LINK =
  "text-ink-soft hover:text-ink underline decoration-1 underline-offset-4 transition-colors duration-150";

function AdLibraryLinks({ name, domain }: { name: string; domain: string }): ReactElement {
  const links = adLibraryLinks({ name, domain });
  return (
    <p data-slot="competitor-ad-links" className="text-body-sm mt-1 flex flex-wrap gap-x-4 gap-y-1">
      <a
        href={links.meta}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Their ads on Meta, ${name} (opens in a new tab)`}
        className={AD_LIBRARY_LINK}
      >
        Their ads on Meta
      </a>
      <a
        href={links.google}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Their ads on Google, ${name} (opens in a new tab)`}
        className={AD_LIBRARY_LINK}
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
          <p data-slot="competitor-domain" className="text-body-sm text-ink-soft [overflow-wrap:anywhere]">{domain}</p>
          <AdLibraryLinks name={name} domain={domain} />
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
