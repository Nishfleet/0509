import { Link } from "react-router";

interface ErrorPageRecoveryProps {
  /**
   * `notFound` — the matched catch-all or a thrown 404. `gone` — a thrown 410
   * (an unprovisioned the public proof ledger, #1309). Both are the same dead-end
   * surface, so the recovery row is shared.
   */
  kind: "notFound" | "gone";
}

/**
 * Issue #3617: the shared recovery row for the 404/410 error page — the one
 * surface every rotated-away brand URL lands on (the /ads catalog rotates by
 * design, #3496).
 *
 * It used to be two generic exits only: "Back to Five to Nine" ("/") and a
 * blank "Open search" ("/search"). A stranger arriving from a stale
 * /ads/<brand> link had no path into the tracked-brand catalog and no signup
 * CTA, and "Open search" threw away the brand they asked for.
 *
 * Both exits now go somewhere real, and the two surfaces that can name the
 * brand keep their existing brand-specific pair (see app/root.tsx):
 *
 * - /brands — the live browse index. /search 302s to /brands for an empty
 *   query (issue #2965), so the old "Open search" link was a second route to
 *   the same index under a name that promised a prefilled query it never
 *   carried.
 * - /auth/signup?source=error-page — the standard signup CTA, tagged with its
 *   own allowlisted acquisition marker (#3358) so the signups/week meter can
 *   attribute the conversion to this surface.
 *
 * Built from the existing `f9-wk-btn` / `f9-wk-btn-quiet` classes and the
 * existing `f9-action-row` container — no new route, no new component family.
 * Rendered by `app/routes/not-found.tsx` and by the 404/410 branch of the root
 * ErrorBoundary; tests/error-page-recovery.test.ts pins the two in step.
 */
export function ErrorPageRecovery({ kind }: ErrorPageRecoveryProps) {
  return (
    <div className="f9-action-row">
      <Link className="f9-wk-btn" to="/brands">
        Browse tracked brands
      </Link>
      <Link className="f9-wk-btn-quiet" to="/auth/signup?source=error-page">
        {kind === "gone" ? "Start a free watch" : "Create a free account"}
      </Link>
    </div>
  );
}
