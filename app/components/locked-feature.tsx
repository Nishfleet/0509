import type { ReactNode } from "react";

import { PrimaryAction, SecondaryAction } from "~/components/evidence";

export interface LockedFeatureProps {
  /** Small kicker naming the surface, e.g. "Reports". */
  eyebrow: string;
  /** Gate headline, e.g. "Client-ready reports". */
  title: string;
  /** One line: what the feature does / why it's locked. No trailing period. */
  reason: string;
  /** Plan that unlocks it, e.g. "Agency plan". */
  planNeeded: string;
  /** Billing URL, e.g. "/app/billing?source=reports#plans". */
  upgradeTo: string;
  /** Primary CTA label. */
  upgradeLabel?: string;
  /** Optional secondary "See an example" link target. */
  seeExampleTo?: string;
  /** Secondary link label. */
  seeExampleLabel?: string;
  /** Heading element — h1 for full-page gates (default), h2 when embedded. */
  headingLevel?: "h1" | "h2";
  /**
   * Honest context for a deep link into the gated surface, stamped in the ink
   * header — "Competitor report" when someone opened a report URL they cannot
   * read. Never the gated content itself.
   */
  context?: string;
  /** Label above the dimmed specimen slot. */
  specimenLabel?: string;
  /**
   * A dimmed, inert preview of what the plan unlocks (brief §6.8 part 3), so
   * the gate is a reserved slot rather than a void. Omitting it leaves the
   * slot out entirely rather than showing an empty box.
   */
  specimen?: ReactNode;
}

/**
 * One shared plan-gate, built as the brief's specimen panel (§6.8) rather than
 * a bare wall: an ink header stating the real state, a headline and one honest
 * paragraph, an optional dimmed specimen of what the plan unlocks, and exactly
 * one Rank-1 action so a gate is never a dead end (§5, DESIGN.md WP-B1).
 *
 * Never the red/error treatment — red stays reserved for diff-deletion and
 * genuine errors (brief §4.5).
 */
export function LockedFeature({
  eyebrow,
  title,
  reason,
  planNeeded,
  upgradeTo,
  upgradeLabel = "Upgrade to Agency",
  seeExampleTo,
  seeExampleLabel = "See an example",
  headingLevel = "h1",
  context,
  specimenLabel = "Included in this plan",
  specimen,
}: LockedFeatureProps) {
  const Heading = headingLevel;
  const titleId = `locked-${eyebrow.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-title`;

  return (
    <section
      aria-labelledby={titleId}
      className="f9-evidence-specimen f9-locked-feature"
      role="status"
    >
      <header className="f9-evidence-plate-header f9-evidence-micro">
        <span>
          {eyebrow} · {planNeeded} required
        </span>
        {context ? <span className="f9-evidence-plate-header-end">{context}</span> : null}
      </header>
      <div className="f9-evidence-specimen-body">
        <Heading className="f9-evidence-specimen-headline" id={titleId}>
          {title}
        </Heading>
        <p className="f9-evidence-specimen-copy">
          {reason} — included in the {planNeeded}.
        </p>
        {specimen ? (
          <div className="f9-evidence-specimen-slot">
            <div aria-hidden="true" className="f9-evidence-specimen-scan" />
            <div className="f9-evidence-specimen-slot-header f9-evidence-micro">{specimenLabel}</div>
            {/* A preview of what the plan unlocks, not content: hidden from
                assistive tech AND removed from the tab order so no dimmed
                control can be reached. */}
            <div aria-hidden="true" className="f9-evidence-specimen-slot-inner" inert>
              {specimen}
            </div>
          </div>
        ) : null}
        <div className="f9-evidence-action-row">
          <PrimaryAction to={upgradeTo}>{upgradeLabel}</PrimaryAction>
          {seeExampleTo ? (
            <SecondaryAction to={seeExampleTo}>{seeExampleLabel}</SecondaryAction>
          ) : null}
        </div>
      </div>
    </section>
  );
}
