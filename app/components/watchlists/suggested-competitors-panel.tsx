import { Form, Link } from "react-router";
import { useState } from "react";

import { SubmitButton } from "~/components/submit-button";
import type { SuggestedCompetitorRow } from "~/lib/auto-competitor-suggested-loader.server";
import type { CompetitorSuggestionCaps } from "~/lib/plan-entitlements";

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
 * 3. Free plan → the loader returns the discovered set as a FROZEN
 *    SNAPSHOT (`caps.frozen`). The rows render read-only with an upgrade
 *    prompt in place of the add button. Onboarding slice 2 (#3175): the
 *    evidence is real and worth showing; acting on it is what the plan buys.
 *
 * Each row carries a one-line `why` and its typed `source` (onboarding slice
 * 2, #3175) so a suggestion always says what it is and where it came from —
 * the row is never a bare brand name the customer has to trust.
 *
 * The accept action calls `createWatchlistWithinLimit` through
 * `handleWatchlistsAction`'s `accept-suggested-competitor` intent. Over-cap
 * responses come back as a `data.overCap` flag — the customer sees a named
 * reason, never a silent admission. The remove action (`dismiss-suggested-
 * competitor`) records a durable dismissal, so a removed row never comes back.
 */

const ACCEPT_INTENT = "accept-suggested-competitor";
const DISMISS_INTENT = "dismiss-suggested-competitor";

/**
 * Human label for a row's typed evidence source. Kept as a total map (not a
 * chain of ternaries) so adding a source to the union is a compile error here
 * until it is named — an unnamed source would otherwise render an empty badge.
 */
const SOURCE_LABELS: Record<SuggestedCompetitorRow["source"], string> = {
  ad_keyword_overlap: "From your ads",
  landing_page_seed: "From your website",
  adjacent_brand_fallback: "Same category",
};

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
  caps: CompetitorSuggestionCaps;
  feedback: SuggestedCompetitorsAcceptFeedback | null;
  pending: boolean;
  pendingCandidateId: string | null;
  pendingDismissCandidateId?: string | null;
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
                <p className="f9-evidence-suggested-why" data-test="suggested-why">
                  {row.why}
                </p>
                <p className="f9-evidence-micro f9-evidence-suggested-source" data-test="suggested-source" data-source={row.source}>
                  {SOURCE_LABELS[row.source]}
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
              {props.caps.frozen ? (
                <div className="f9-evidence-suggested-actions">
                  <p
                    className="f9-evidence-micro f9-evidence-suggested-frozen"
                    data-test="suggested-frozen"
                  >
                    Snapshot — upgrade to track these
                  </p>
                  {/* Free can still remove a row: the issue's "one-tap remove"
                      does not consume a watchlist slot, and a snapshot the
                      customer cannot prune is worse than no snapshot. */}
                  <Form method="post" className="f9-evidence-suggested-dismiss-form">
                    <input name="intent" type="hidden" value={DISMISS_INTENT} />
                    <input name="candidateId" type="hidden" value={row.candidateId} />
                    <SubmitButton
                      className="f9-evidence-cta f9-evidence-cta--quiet"
                      pending={
                        props.pending && props.pendingDismissCandidateId === row.candidateId
                      }
                      pendingLabel="Removing…"
                    >
                      Remove
                    </SubmitButton>
                  </Form>
                </div>
              ) : (
                <div className="f9-evidence-suggested-actions">
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
                  <Form method="post" className="f9-evidence-suggested-dismiss-form">
                    <input name="intent" type="hidden" value={DISMISS_INTENT} />
                    <input name="candidateId" type="hidden" value={row.candidateId} />
                    <SubmitButton
                      className="f9-evidence-cta f9-evidence-cta--quiet"
                      pending={
                        props.pending && props.pendingDismissCandidateId === row.candidateId
                      }
                      pendingLabel="Removing…"
                    >
                      Remove
                    </SubmitButton>
                  </Form>
                </div>
              )}
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
  /**
   * Issue #2174 — signed handoff token carrying the searched domain + the
   * top candidates. When present, the visitor can select several candidates
   * and carry them through signup into onboarding with zero re-entry. When
   * null (no secret, or discovery failed), the panel falls back to the
   * single-domain signup links.
   */
  handoffToken: string | null;
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

      {props.handoffToken ? (
        <CompetitorPreviewSelectable
          rows={props.rows}
          handoffToken={props.handoffToken}
          signupPath={props.signupPath}
        />
      ) : (
        <CompetitorPreviewLinks
          rows={props.rows}
          signupPath={props.signupPath}
          signupPathForRow={props.signupPathForRow}
        />
      )}
    </section>
  );
}

/**
 * Issue #2174 — the selectable preview. The visitor checks the competitors
 * they want to watch; the CTA carries the signed handoff token plus the
 * picked candidate indexes into signup, so onboarding can confirm exactly
 * the chosen set with zero re-entry. All rows start checked (the panel's
 * promise is "watch these N competitors"); unchecking narrows the set.
 */
function CompetitorPreviewSelectable(props: {
  rows: readonly SuggestedCompetitorRow[];
  handoffToken: string;
  signupPath: string;
}) {
  const [selected, setSelected] = useState<ReadonlySet<number>>(
    () => new Set(props.rows.map((_, index) => index)),
  );
  const toggle = (index: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };
  const selectedCount = selected.size;
  const pick = Array.from(selected)
    .sort((left, right) => left - right)
    .join(",");
  const signupPath = buildHandoffSignupPath(props.handoffToken, pick, props.signupPath);
  return (
    <>
      <ul className="f9-evidence-suggested-list" data-test="competitor-preview-list">
        {props.rows.map((row, index) => (
          <li
            key={row.candidateId}
            className="f9-evidence-suggested-row"
            data-test="competitor-preview-row"
            data-candidate-type={row.type}
          >
            <label className="f9-evidence-suggested-select">
              <input
                type="checkbox"
                data-test="competitor-preview-select"
                data-candidate-index={index}
                checked={selected.has(index)}
                onChange={() => toggle(index)}
              />
              <span className="f9-evidence-suggested-meta">
                <span className="f9-evidence-suggested-name">
                  <span
                    className="f9-evidence-suggested-marker"
                    data-test="competitor-preview-marker"
                  >
                    Suggested · unverified
                  </span>
                  <span className="f9-evidence-suggested-brand">{row.advertiser}</span>
                </span>
                <span className="f9-evidence-micro f9-evidence-suggested-provenance" data-test="competitor-preview-provenance">
                  {row.provenance}
                </span>
                <span
                  className="f9-evidence-micro f9-evidence-suggested-score"
                  data-overlap-score={row.overlapScore}
                >
                  Overlap {formatOverlapScore(row.overlapScore)}
                  {row.targetCountry ? ` · ${row.targetCountry}` : ""}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      <div className="f9-evidence-action-row">
        <Link
          className="f9-evidence-cta f9-evidence-cta--rank2"
          data-test="competitor-preview-cta"
          to={signupPath}
        >
          {selectedCount === 0
            ? "Create a free account to watch competitors"
            : `Create a free account to watch ${selectedCount} ${selectedCount === 1 ? "competitor" : "competitors"}`}
        </Link>
      </div>
    </>
  );
}

/**
 * The non-handoff fallback: per-row "Watch <advertiser>" links plus the
 * panel-level signup CTA, each carrying a single domain into post-signup
 * setup (the pre-#2174 behavior).
 */
function CompetitorPreviewLinks(props: {
  rows: readonly SuggestedCompetitorRow[];
  signupPath: string;
  signupPathForRow: (row: SuggestedCompetitorRow) => string;
}) {
  return (
    <>
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
    </>
  );
}

/**
 * Build the signup path that carries the handoff token + the picked
 * candidate indexes. The token is signed and short-lived; the pick is a
 * comma-separated list of indexes into the token's candidate array, so a
 * tampered pick can only select a subset of the already-signed candidates.
 * The onboarding action re-validates every candidate against the plan cap
 * and the existing watchlist-dedupe before creating anything.
 */
function buildHandoffSignupPath(
  handoffToken: string,
  pick: string,
  fallbackSignupPath: string,
): string {
  const url = new URL(fallbackSignupPath, "https://f9.invalid");
  const redirectTo = url.searchParams.get("redirectTo") ?? "/app#setup-checklist";
  const appUrl = new URL(redirectTo, "https://f9.invalid");
  appUrl.searchParams.set("handoff", handoffToken);
  if (pick) {
    appUrl.searchParams.set("pick", pick);
  }
  url.searchParams.set("redirectTo", `${appUrl.pathname}${appUrl.search}${appUrl.hash}`);
  return `${url.pathname}${url.search}`;
}