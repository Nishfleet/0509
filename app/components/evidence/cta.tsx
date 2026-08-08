import type { ReactNode } from "react";
import { Link } from "react-router";

/**
 * Evidence Desk CTA ranks — brief §5.
 *
 * The audit's defect #4 was four-plus interchangeable button styles. This
 * module is the whole workspace button API: exactly three ranks and nothing
 * else. Navigation (tabs, band rows, the contents rail) is NOT a CTA and must
 * never borrow one of these.
 *
 * - Rank 1 (`PrimaryAction`)   — ink fill + green offset. Once per screen,
 *   for the single thing the page exists to do. Never full-width, never
 *   inside a repeating row, never a cross-navigation shortcut (DESIGN.md
 *   WP-A3). A screen with zero Rank-1 actions is legitimate; two is a bug.
 * - Rank 2 (`SecondaryAction`) — hairline. The default rank; repeatable
 *   actions that live inside a card, band or plate.
 * - Rank 3 (`TertiaryAction`)  — underlined text, accent underline. Reversible
 *   in-row, low-frequency actions.
 *
 * All three carry a 44px minimum touch target (brief §9.6) and a visible
 * focus ring that is not the offset shadow (brief §10).
 */

export type EvidenceActionRank = 1 | 2 | 3;

export interface EvidenceActionProps {
  children: ReactNode;
  /** Internal route — renders a react-router <Link>. */
  to?: string;
  /** External/absolute target — renders a plain <a>. */
  href?: string;
  /** Button type when neither `to` nor `href` is given. */
  type?: "button" | "submit" | "reset";
  name?: string;
  value?: string;
  form?: string;
  disabled?: boolean;
  onClick?: () => void;
  /** Drops the label to 10px for dense action rows. */
  small?: boolean;
  title?: string;
  /** Rel/target for external anchors. */
  rel?: string;
  target?: string;
  className?: string;
  "aria-label"?: string;
  /**
   * Announces an in-flight action on THIS control. BL-007: a pause/resume
   * control must be busy for its own row only — a shared fetcher used to
   * light every band up at once.
   */
  "aria-busy"?: boolean;
}

function classesFor(rank: EvidenceActionRank, small?: boolean, className?: string): string {
  return ["f9-evidence-cta", `f9-evidence-cta--rank${rank}`, small ? "is-small" : "", className]
    .filter(Boolean)
    .join(" ");
}

function EvidenceAction({ rank, props }: { rank: EvidenceActionRank; props: EvidenceActionProps }) {
  const {
    children,
    to,
    href,
    type = "button",
    name,
    value,
    form,
    disabled,
    onClick,
    small,
    title,
    rel,
    target,
    className,
    "aria-label": ariaLabel,
    "aria-busy": ariaBusy,
  } = props;
  const classes = classesFor(rank, small, className);

  if (to !== undefined) {
    return (
      <Link className={classes} to={to} title={title} aria-label={ariaLabel} onClick={onClick}>
        {children}
      </Link>
    );
  }

  if (href !== undefined) {
    return (
      <a
        className={classes}
        href={href}
        rel={rel}
        target={target}
        title={title}
        aria-label={ariaLabel}
        onClick={onClick}
      >
        {children}
      </a>
    );
  }

  return (
    <button
      className={classes}
      type={type}
      name={name}
      value={value}
      form={form}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      aria-busy={ariaBusy || undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Rank 1 — the one thing this screen exists to do. */
export function PrimaryAction(props: EvidenceActionProps) {
  return <EvidenceAction rank={1} props={props} />;
}

/** Rank 2 — the default. Repeatable actions inside a card, band or plate. */
export function SecondaryAction(props: EvidenceActionProps) {
  return <EvidenceAction rank={2} props={props} />;
}

/** Rank 3 — reversible, in-row, low-frequency. */
export function TertiaryAction(props: EvidenceActionProps) {
  return <EvidenceAction rank={3} props={props} />;
}
