import type { ReactNode } from "react";

import { PrimaryAction, SecondaryAction } from "./cta";

/**
 * Specimen empty state — brief §6.8. Replaces A3 (mascot + one line in a
 * void) and A2 (a grid of empty boxes).
 *
 * An empty state is a PANEL, not a void, with exactly four parts:
 *   1. an ink header strip stating the real state in mono,
 *   2. a headline and one honest paragraph saying what will fill the space
 *      and when,
 *   3. a dimmed specimen or a numbered reserved slot — the slot keeps its
 *      number so the state reads as *reserved*, not *broken*,
 *   4. one Rank-1 action and at most one Rank-2.
 *
 * The API enforces part 4: there is exactly one slot for each rank, so a
 * screen cannot grow a second primary here.
 */

export const RESERVED_SLOT_LABEL = "PLATE 01 — PENDING";

export const RESERVED_SLOT_COPY =
  "This slot is reserved. The first capture fills it — nothing is broken.";

export interface SpecimenAction {
  label: string;
  to?: string;
  href?: string;
  onClick?: () => void;
}

export function SpecimenEmptyState({
  stateLabel,
  headline,
  copy,
  specimenLabel = RESERVED_SLOT_LABEL,
  specimen,
  primaryAction,
  secondaryAction,
  className,
}: {
  /** The real state, in mono: "OKARA · FIRST CAPTURE RUNNING · STARTED 03:12 UTC". */
  stateLabel: string;
  headline: string;
  /** What will fill the space, and when. Product voice, never "No data". */
  copy: string;
  specimenLabel?: string;
  /** The real component rendered from sample data; omitted = reserved slot. */
  specimen?: ReactNode;
  primaryAction?: SpecimenAction;
  secondaryAction?: SpecimenAction;
  className?: string;
}) {
  return (
    <section className={className ? `f9-ed-specimen ${className}` : "f9-ed-specimen"}>
      <header className="f9-ed-plate-header f9-ed-micro">
        <span>{stateLabel}</span>
      </header>
      <div className="f9-ed-specimen-body">
        <h2 className="f9-ed-specimen-headline">{headline}</h2>
        <p className="f9-ed-specimen-copy">{copy}</p>
        <div className="f9-ed-specimen-slot">
          <div className="f9-ed-specimen-scan" aria-hidden="true" />
          <div className="f9-ed-specimen-slot-header f9-ed-micro">{specimenLabel}</div>
          <div className="f9-ed-specimen-slot-inner" aria-hidden="true">
            {specimen ?? <p className="f9-ed-specimen-copy">{RESERVED_SLOT_COPY}</p>}
          </div>
        </div>
        {primaryAction || secondaryAction ? (
          <div className="f9-ed-action-row">
            {primaryAction ? (
              <PrimaryAction
                to={primaryAction.to}
                href={primaryAction.href}
                onClick={primaryAction.onClick}
              >
                {primaryAction.label}
              </PrimaryAction>
            ) : null}
            {secondaryAction ? (
              <SecondaryAction
                to={secondaryAction.to}
                href={secondaryAction.href}
                onClick={secondaryAction.onClick}
              >
                {secondaryAction.label}
              </SecondaryAction>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
