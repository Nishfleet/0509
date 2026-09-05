import type { ReactNode } from "react";

import { type ActionTarget, resolveActionTarget } from "./action-target";
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

/** An empty-state action must go somewhere — see `action-target.ts`. */
export type SpecimenAction = { label: string } & ActionTarget;

export function SpecimenEmptyState({
  stateLabel,
  headline,
  headingLevel = 2,
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
  /** Fits the panel to the surrounding document outline. */
  headingLevel?: 2 | 3 | 4;
  /** What will fill the space, and when. Product voice, never "No data". */
  copy: string;
  specimenLabel?: string;
  /** The real component rendered from sample data; omitted = reserved slot. */
  specimen?: ReactNode;
  primaryAction?: SpecimenAction;
  secondaryAction?: SpecimenAction;
  className?: string;
}) {
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";

  return (
    <section className={className ? `f9-evidence-specimen ${className}` : "f9-evidence-specimen"}>
      <header className="f9-evidence-plate-header f9-evidence-micro">
        <span>{stateLabel}</span>
      </header>
      <div className="f9-evidence-specimen-body">
        <Heading className="f9-evidence-specimen-headline">{headline}</Heading>
        <p className="f9-evidence-specimen-copy">{copy}</p>
        <div className="f9-evidence-specimen-slot">
          <div className="f9-evidence-specimen-scan" aria-hidden="true" />
          <div className="f9-evidence-specimen-slot-header f9-evidence-micro">{specimenLabel}</div>
          {/* The specimen is a preview of what will land here, not content:
              hidden from assistive tech AND removed from the tab order, so a
              dimmed sample control can never be reached. */}
          <div className="f9-evidence-specimen-slot-inner" aria-hidden="true" inert>
            {specimen ?? <p className="f9-evidence-specimen-copy">{RESERVED_SLOT_COPY}</p>}
          </div>
        </div>
        {primaryAction || secondaryAction ? (
          <div className="f9-evidence-action-row">
            {primaryAction ? (
              <PrimaryAction {...resolveActionTarget(primaryAction)}>
                {primaryAction.label}
              </PrimaryAction>
            ) : null}
            {secondaryAction ? (
              <SecondaryAction {...resolveActionTarget(secondaryAction)}>
                {secondaryAction.label}
              </SecondaryAction>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
