import { Link } from "react-router";

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
}

/**
 * One shared plan-gate. Neutral bone panel, never the red/error treatment
 * (red stays reserved for diff-deletion and genuine errors). Always renders a
 * single primary upgrade CTA so a gate is never a dead end.
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
}: LockedFeatureProps) {
  const Heading = headingLevel;
  const titleId = `locked-${eyebrow.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-title`;

  return (
    <article
      className="f9-app-panel f9-locked-feature"
      aria-labelledby={titleId}
      role="status"
    >
      <p className="f9-app-kicker">{eyebrow}</p>
      <Heading id={titleId}>{title}</Heading>
      <p>
        {reason} — included in the {planNeeded}.
      </p>
      <div className="f9-locked-feature-actions">
        <Link className="f9-primary-button" to={upgradeTo}>
          {upgradeLabel}
        </Link>
        {seeExampleTo ? (
          <Link className="f9-secondary-button" to={seeExampleTo}>
            {seeExampleLabel}
          </Link>
        ) : null}
      </div>
    </article>
  );
}
