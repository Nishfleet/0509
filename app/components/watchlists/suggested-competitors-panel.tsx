import { Form, Link } from "react-router";

import { SubmitButton } from "~/components/submit-button";
import type { SuggestedCompetitorRow } from "~/lib/auto-competitor-suggested-loader.server";

/**
 * Suggested-competitors panel (auto-competitor-watch, Phase 2).
 *
 * Props-threaded, presentational, no hooks, no context — matches the
 * `app/components/watchlists/*` convention. The loader pre-shapes the
 * rows (enforces candidate-only, dedupes, sorts by overlapScore desc,
 * clips to the panel cap); this component renders them honestly.
 *
 * Three honest states this component MUST get right:
 *
 * 1. Paid plan + rows → renders one card per row, each carrying the
 *    "suggested / unverified" marker + provenance line + one-click accept
 *    form. Honesty eval 3.4: 100%.
 * 2. Paid plan + no rows → renders the empty state (no fabricated
 *    suggestion). The action is the customer editing their own
 *    `brandWebsite` in workspace branding; nothing else.
 * 3. Free plan → the loader returns `null`, this component is not
 *    rendered at all by the route.
 *
 * The accept action calls `createWatchlistWithinLimit` through
 * `handleWatchlistsAction`'s `accept-suggested-competitor` intent. Over-cap
 * responses come back as a `data.overCap` flag — the customer sees a named
 * reason, never a silent admission.
 */

const ACCEPT_INTENT = "accept-suggested-competitor";

export interface SuggestedCompetitorsAcceptFeedback {
  ok?: boolean | undefined;
  error?: "plan_limit_exceeded" | "candidate_unknown" | undefined;
  message?: string | undefined;
  acceptedCandidateId?: string | undefined;
  acceptedAdvertiser?: string | undefined;
  watchlistId?: string | undefined;
}

export function SuggestedCompetitorsPanel(props: {
  domain: string;
  rows: readonly SuggestedCompetitorRow[];
  feedback: SuggestedCompetitorsAcceptFeedback | null;
  pending: boolean;
  pendingCandidateId: string | null;
}) {
  return (
    <section
      aria-label="Suggested competitors"
      className="f9-evidence-cell f9-evidence-suggested-cell"
      data-test="suggested-competitors-panel"
    >
      <header className="f9-evidence-cell-head">
        <p className="f9-wk-kick">Suggested competitors</p>
        <p className="f9-evidence-micro">
          {props.domain
            ? `Auto-discovered from ${props.domain}'s ads · unverified until you accept`
            : "Auto-discovered candidates · unverified until you accept"}
        </p>
      </header>

      {props.feedback && props.feedback.error ? (
        <p
          role="status"
          aria-live="polite"
          className={`f9-evidence-line f9-evidence-line--alert${
            props.feedback.error === "plan_limit_exceeded" ? " is-error" : ""
          }`}
        >
          {props.feedback.message ?? "We couldn't add that competitor. Try again or pick another."}
        </p>
      ) : null}

      {props.feedback && props.feedback.ok ? (
        <p role="status" aria-live="polite" className="f9-evidence-line is-success">
          {props.feedback.message ?? `Now watching ${props.feedback.acceptedAdvertiser ?? "that competitor"}.`}
        </p>
      ) : null}

      {props.rows.length === 0 ? (
        <p className="f9-evidence-line" data-test="suggested-empty">
          {props.domain
            ? `We don't have suggestions for ${props.domain} yet. Add your brand's website in workspace branding, and we'll surface real candidates here when we find them — we never invent suggestions.`
            : "Add your brand's website in workspace branding, and we'll surface real candidates here when we find them — we never invent suggestions."}
        </p>
      ) : (
        <ul className="f9-evidence-suggested-list" data-test="suggested-list">
          {props.rows.map((row) => (
            <li
              key={row.candidateId}
              className="f9-evidence-suggested-row"
              data-test="suggested-row"
              data-candidate-type={row.type}
              data-candidate-id={row.candidateId}
            >
              <div className="f9-evidence-suggested-meta">
                <p className="f9-evidence-suggested-name">
                  <span className="f9-evidence-suggested-marker" data-test="suggested-marker">
                    Suggested · unverified
                  </span>
                  <span className="f9-evidence-suggested-brand">{row.advertiser}</span>
                </p>
                <p className="f9-evidence-micro f9-evidence-suggested-provenance" data-test="suggested-provenance">
                  {row.provenance}
                </p>
                <p
                  className="f9-evidence-micro f9-evidence-suggested-score"
                  data-test="suggested-overlap"
                  data-overlap-score={row.overlapScore}
                >
                  Overlap {formatOverlapScore(row.overlapScore)}
                  {row.targetCountry ? ` · ${row.targetCountry}` : ""}
                </p>
              </div>
              <Form method="post" className="f9-evidence-suggested-accept-form">
                <input name="intent" type="hidden" value={ACCEPT_INTENT} />
                <input name="candidateId" type="hidden" value={row.candidateId} />
                <SubmitButton
                  className="f9-evidence-cta f9-evidence-cta--rank2"
                  pending={props.pending && props.pendingCandidateId === row.candidateId}
                  pendingLabel="Adding…"
                >
                  Add as competitor
                </SubmitButton>
              </Form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatOverlapScore(score: number): string {
  if (!Number.isFinite(score)) {
    return "—";
  }
  const clamped = Math.max(0, Math.min(1, score));
  return `${Math.round(clamped * 100)}%`;
}

/**
 * Helper for the route — when the loader returns `null`, the panel is
 * omitted entirely. When the loader returns `{ rows: [] }`, the panel is
 * rendered with the honest empty state.
 */
export function shouldRenderSuggestedCompetitorsPanel(
  panel: { rows: readonly SuggestedCompetitorRow[] } | null | undefined,
): panel is { rows: readonly SuggestedCompetitorRow[] } {
  return Boolean(panel);
}

/**
 * Logged-out /search preview (issue #2113): "who advertises against you".
 *
 * The search route runs the EXISTING suggested-competitors discovery phase
 * server-side for a logged-out domain query and hands the top rows here.
 * This is a read-only teaser of the signed-in panel above: same row
 * contract (candidate-only, provenance, overlap), but the accept form is
 * replaced by signup links — a visitor cannot accept a suggestion before
 * they have an account, so every CTA routes through /auth/signup carrying
 * the competitor's domain into the post-signup setup checklist.
 *
 * Honesty invariants inherited from the signed-in panel:
 *
 * 1. Every row keeps the "Suggested · unverified" marker — a preview row
 *    is never presented as a confirmed competitor (eval 3.4).
 * 2. An empty row set renders NOTHING (the section wrapper omits the
 *    panel) — discovery returning nothing must never become a fabricated
 *    suggestion.
 * 3. CTA ranks stay at rank2/rank3 — the page's single ink fill belongs
 *    to the retention band below (BL-031 one-fill-per-viewport law).
 */
export function SuggestedCompetitorPreviewPanel(props: {
  domain: string;
  rows: readonly SuggestedCompetitorRow[];
  /** Signup path carrying the searched domain into post-signup setup. */
  signupPath: string;
  /** Per-row signup path carrying THAT competitor's domain. */
  signupPathForRow: (row: SuggestedCompetitorRow) => string;
}) {
  if (props.rows.length === 0) {
    return null;
  }
  return (
    <section
      aria-label="Who advertises against you"
      className="f9-evidence-cell f9-evidence-suggested-cell"
      data-test="competitor-preview-panel"
    >
      <header className="f9-evidence-cell-head">
        <p className="f9-wk-kick">Who advertises against you</p>
        <p className="f9-evidence-micro">
          {`Advertisers with active Meta ads on the same searches as ${props.domain} — suggested and unverified until you watch them.`}
        </p>
      </header>

      <ul className="f9-evidence-suggested-list" data-test="competitor-preview-list">
        {props.rows.map((row) => (
          <li
            key={row.candidateId}
            className="f9-evidence-suggested-row"
            data-test="competitor-preview-row"
            data-candidate-type={row.type}
          >
            <div className="f9-evidence-suggested-meta">
              <p className="f9-evidence-suggested-name">
                <span
                  className="f9-evidence-suggested-marker"
                  data-test="competitor-preview-marker"
                >
                  Suggested · unverified
                </span>
                <span className="f9-evidence-suggested-brand">{row.advertiser}</span>
              </p>
              <p
                className="f9-evidence-micro f9-evidence-suggested-provenance"
                data-test="competitor-preview-provenance"
              >
                {row.provenance}
              </p>
              <p
                className="f9-evidence-micro f9-evidence-suggested-score"
                data-overlap-score={row.overlapScore}
              >
                Overlap {formatOverlapScore(row.overlapScore)}
                {row.targetCountry ? ` · ${row.targetCountry}` : ""}
              </p>
            </div>
            <Link
              className="f9-evidence-cta f9-evidence-cta--rank3"
              data-test="competitor-preview-row-cta"
              to={props.signupPathForRow(row)}
            >
              {`Watch ${row.advertiser}`}
            </Link>
          </li>
        ))}
      </ul>

      <div className="f9-evidence-action-row">
        <Link
          className="f9-evidence-cta f9-evidence-cta--rank2"
          data-test="competitor-preview-cta"
          to={props.signupPath}
        >
          {`Create a free account to watch these ${props.rows.length} competitors`}
        </Link>
      </div>
    </section>
  );
}