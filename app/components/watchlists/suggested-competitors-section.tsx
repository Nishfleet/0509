import type { useNavigation } from "react-router";

import {
  SuggestedCompetitorsPanel,
  SuggestedCompetitorPreviewPanel,
  type SuggestedCompetitorsAcceptFeedback,
} from "~/components/watchlists/suggested-competitors-panel";
import { buildSignupTrackingPath } from "~/lib/competitor-website";
import type {
  SuggestedCompetitorRow,
  SuggestedCompetitorsPanelData,
} from "~/lib/auto-competitor-suggested-loader.server";

type NavigationResult = ReturnType<typeof useNavigation>;

/**
 * Auto-competitor-watch Phase 2 (#1370): thin section wrapper that mounts
 * the suggested-competitors panel on the watchlists board.
 *
 * Lives in its own component so the route file (already at the BL-007
 * 800-line ceiling before this PR) does not grow past the ceiling. The
 * wrapper:
 *
 * 1. Hides itself when the loader returns `null` (no self-brand domain
 *    resolvable — the panel needs a domain to seed from).
 * 2. Hides itself on the deep view (one selected competitor) — the panel
 *    is about "things you haven't tracked yet", not the one you're
 *    currently inspecting.
 * 3. Translates the route's `useNavigation()` shape into the panel's
 *    pending props (both the accept and the remove leg), and translates the
 *    generic `{ ok, error, message, ... }` action-data shape into the panel's
 *    typed feedback.
 *
 * Returns `null` in any branch where the panel should not render, so the
 * route just drops the section in with one JSX line.
 */
export function WatchlistsSuggestedCompetitorsSection(props: {
  panel: SuggestedCompetitorsPanelData | null;
  isBoardView: boolean;
  routeActionData: unknown;
  navigation: NavigationResult;
}) {
  if (!props.isBoardView) {
    return null;
  }
  if (!props.panel) {
    return null;
  }

  const pending =
    props.navigation.state !== "idle" &&
    props.navigation.formData?.get("intent") === "accept-suggested-competitor";
  const pendingCandidateId =
    pending && props.navigation.formData
      ? String(props.navigation.formData.get("candidateId") ?? "")
      : null;
  const pendingDismiss =
    props.navigation.state !== "idle" &&
    props.navigation.formData?.get("intent") === "dismiss-suggested-competitor";
  const pendingDismissCandidateId =
    pendingDismiss && props.navigation.formData
      ? String(props.navigation.formData.get("candidateId") ?? "")
      : null;

  return (
    <SuggestedCompetitorsPanel
      domain={props.panel.domain}
      rows={props.panel.rows}
      caps={props.panel.caps}
      feedback={resolveSuggestedPanelFeedback(props.routeActionData)}
      pending={pending}
      pendingCandidateId={pendingCandidateId}
      pendingDismissCandidateId={pendingDismissCandidateId}
    />
  );
}

/**
 * Pluck the suggested-panel feedback out of the route action data. The
 * action returns the same response shape for every intent — a generic
 * `{ ok, error, message, ... }` — so this filter distinguishes the
 * suggested-panel intents from the rest by the presence of a panel-shaped
 * field (`acceptedCandidateId` for success, one of the panel's named
 * errors otherwise) rather than by intent name (which would couple the
 * route to the action's internals).
 *
 * The shape matches `SuggestedCompetitorsAcceptFeedback`; the conversion
 * here is the boundary between the action's generic protocol and the
 * panel's specific vocabulary.
 */
export function resolveSuggestedPanelFeedback(
  actionData: unknown,
): SuggestedCompetitorsAcceptFeedback | null {
  if (!actionData || typeof actionData !== "object") {
    return null;
  }
  const candidate = actionData as Record<string, unknown>;
  const isOk = candidate.ok === true;
  const isPanelError =
    candidate.error === "plan_limit_exceeded" || candidate.error === "candidate_unknown";
  const isPanelOk =
    isOk &&
    (typeof candidate.acceptedCandidateId === "string" ||
      typeof candidate.acceptedAdvertiser === "string" ||
      // Onboarding slice 2 (#3175): the remove leg's success shape. Without
      // this the removal succeeded server-side but the panel showed nothing,
      // which is exactly the silent-success the feedback contract forbids.
      typeof candidate.dismissedCandidateId === "string");
  if (!isPanelOk && !isPanelError) {
    return null;
  }
  return {
    ok: isPanelOk ? true : undefined,
    error: isPanelError
      ? (candidate.error as "plan_limit_exceeded" | "candidate_unknown")
      : undefined,
    message: typeof candidate.message === "string" ? candidate.message : undefined,
    acceptedCandidateId:
      typeof candidate.acceptedCandidateId === "string"
        ? candidate.acceptedCandidateId
        : undefined,
    acceptedAdvertiser:
      typeof candidate.acceptedAdvertiser === "string" ? candidate.acceptedAdvertiser : undefined,
    watchlistId:
      typeof candidate.watchlistId === "string" ? candidate.watchlistId : undefined,
  };
}

/**
 * Logged-out /search preview section (issue #2113): the search route's
 * counterpart to `WatchlistsSuggestedCompetitorsSection`.
 *
 * The /search loader runs the existing suggested-competitors discovery
 * phase server-side when a logged-out visitor searches a domain, and
 * passes the shaped top rows in as `preview`. This wrapper:
 *
 * 1. Omits itself when the loader returned `null` (non-domain query, a
 *    signed-in session, or a discovery failure) or when discovery found
 *    zero candidates — an empty preview is never fabricated into a
 *    suggestion.
 * 2. Builds the signup paths: the panel CTA carries the searched domain,
 *    each row's "Watch" link carries THAT competitor's domain, so the
 *    post-signup setup checklist prefills exactly what the visitor picked.
 *    A row without a resolvable domain falls back to the panel-level path
 *    rather than inventing a website from the advertiser name.
 */
export function SearchCompetitorPreviewSection(props: {
  preview: SuggestedCompetitorsPanelData | null;
  handoffToken: string | null;
  country: string;
}) {
  if (!props.preview || props.preview.rows.length === 0) {
    return null;
  }
  const signupPath = buildSignupTrackingPath({
    competitorWebsiteRaw: props.preview.domain,
    ads: [],
    country: props.country,
  });
  const signupPathForRow = (row: SuggestedCompetitorRow) =>
    row.landingPageUrl
      ? buildSignupTrackingPath({
          competitorWebsiteRaw: row.landingPageUrl,
          ads: [],
          country: props.country,
        })
      : signupPath;
  return (
    <SuggestedCompetitorPreviewPanel
      domain={props.preview.domain}
      rows={props.preview.rows}
      signupPath={signupPath}
      signupPathForRow={signupPathForRow}
      handoffToken={props.handoffToken}
    />
  );
}