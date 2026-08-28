import type { useNavigation } from "react-router";

import {
  SuggestedCompetitorsPanel,
  type SuggestedCompetitorsAcceptFeedback,
} from "~/components/watchlists/suggested-competitors-panel";
import type { SuggestedCompetitorsPanelData } from "~/lib/auto-competitor-suggested-loader.server";

type NavigationResult = ReturnType<typeof useNavigation>;

/**
 * Auto-competitor-watch Phase 2 (#1370): thin section wrapper that mounts
 * the suggested-competitors panel on the watchlists board.
 *
 * Lives in its own component so the route file (already at the BL-007
 * 800-line ceiling before this PR) does not grow past the ceiling. The
 * wrapper:
 *
 * 1. Hides itself when the loader returns `null` (free plan — paid gate).
 * 2. Hides itself on the deep view (one selected competitor) — the panel
 *    is about "things you haven't tracked yet", not the one you're
 *    currently inspecting.
 * 3. Translates the route's `useNavigation()` shape into the panel's
 *    pending prop, and translates the generic `{ ok, error, message, ... }`
 *    action-data shape into the panel's typed feedback.
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

  return (
    <SuggestedCompetitorsPanel
      domain={props.panel.domain}
      rows={props.panel.rows}
      feedback={resolveSuggestedPanelFeedback(props.routeActionData)}
      pending={pending}
      pendingCandidateId={pendingCandidateId}
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
      typeof candidate.acceptedAdvertiser === "string");
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