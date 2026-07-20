import type { ReactNode } from "react";

/**
 * The one small "pill" badge used across search results, watchlists, reports,
 * dossiers, and billing. Three visual families, each an existing CSS class set
 * kept byte-for-byte so the migration is zero visual change:
 *
 * - `status`    → `f9-status-pill` (neutral metadata / health chips)
 * - `longevity` → `f9-longevity-pill` (green "Running N days" + neutral kin)
 * - `angle`     → `f9-longevity-pill f9-angle-pill` (marketing-angle chip)
 *
 * `state` appends the family's `is-*` modifier (e.g. status "healthy",
 * longevity "strong" | "tracked" | "sample", angle "tentative"). Callers that
 * still need a bespoke class can pass `className`.
 */

export type PillVariant = "status" | "longevity" | "angle";

const VARIANT_BASE_CLASS: Record<PillVariant, string> = {
  status: "f9-status-pill",
  longevity: "f9-longevity-pill",
  angle: "f9-longevity-pill f9-angle-pill",
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
