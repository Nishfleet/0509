import type { ReactNode } from "react";

/**
 * The one small "pill" badge used across search results, watchlists, reports,
 * dossiers, and billing. Three visual families, each an existing CSS class set
 * kept byte-for-byte so the migration is zero visual change:
 *
 * - `status`    → `f9-status-pill` (neutral metadata / health chips)
 * - `longevity` → `f9-longevity-pill` (green "Running N days" + neutral kin)
 * - `angle`     → `f9-longevity-pill f9-angle-pill` (marketing-angle chip)
 * - `stamp`     → `f9-evidence-stamp` (Evidence Desk state stamp, brief §6.1)
 *
 * `state` appends the family's `is-*` modifier (e.g. status "healthy",
 * longevity "strong" | "tracked" | "sample", angle "tentative", stamp
 * "caught" | "quiet" | "watching" | "pending"). Callers that still need a
 * bespoke class can pass `className`.
 *
 * The `stamp` family is square, mono and ruled — it is the band/plate state
 * marker of the Evidence Desk, not a chip. It is never clickable: the accent
 * on `is-watching` is a state marker, never an affordance (brief §4.5).
 */

export type PillVariant = "status" | "longevity" | "angle" | "stamp";

const VARIANT_BASE_CLASS: Record<PillVariant, string> = {
  status: "f9-status-pill",
  longevity: "f9-longevity-pill",
  angle: "f9-longevity-pill f9-angle-pill",
  stamp: "f9-evidence-stamp",
};

export function Pill({
  variant = "status",
  state,
  title,
  className,
  children,
}: {
  variant?: PillVariant;
  /** Appended as `is-${state}`; omit for the default look. */
  state?: string;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  const classes = [VARIANT_BASE_CLASS[variant], state ? `is-${state}` : "", className]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={classes} title={title}>
      {children}
    </span>
  );
}
