import type { LoaderFunctionArgs } from "react-router";

/**
 * `/api/v1/watchlists/:watchlistId/runs/latest` — run-history with capture
 * attempts (issue #1289).
 *
 * Surfaces every capture attempt the latest monitoring run made — including
 * failed and skipped captures with a public reason code — so a buyer can see
 * what was checked and why a check did not produce an alert. A failed
 * capture is never an alert, but it is always visible here.
 *
 * Read-only: requires an active customer API key with the `api_access`
 * plan feature (Free, Scout, Starter, or Agency). No live scraping is
 * triggered; this is a read of existing
 * `proof_capture` rows associated with the run by watchlist + attempted-at
 * window (no migration — `proof_capture` is append-only).
 */
export async function loader({ context, params, request }: LoaderFunctionArgs) {
  const { authenticateApiKeyRequest } = await import("~/lib/api-keys.server");
  const { getEnv } = await import("~/lib/context.server");
  const { requireWorkspacePlanFeature } = await import("~/lib/plan-feature-gate.server");
  const { resolveWorkspaceDataUserId } = await import("~/lib/workspace.server");
  const {
    createAuthenticatedApiLimitContext,
    enforceAuthenticatedApiLimit,
  } = await import("~/lib/authenticated-api-limits.server");
  const { getWatchlist } = await import("~/lib/data.server");
  const { getLatestWatchlistRun } = await import("~/lib/data/watchlist-runs.server");
  const { listCaptureAttemptsForRun } = await import("~/lib/data/watchlist-run-capture-attempts.server");

  const env = getEnv(context);
  const auth = await authenticateApiKeyRequest(env, request);
  if (!auth.ok) {
    return auth.response;
  }

  const workspaceUserId = await resolveWorkspaceDataUserId(env, auth.apiKey.userId);
  const apiLimit = createAuthenticatedApiLimitContext(env, {
    workspaceUserId,
    actorUserId: auth.apiKey.userId,
    apiKeyId: auth.apiKey.id,
  });
  const limitResponse = await enforceAuthenticatedApiLimit({
    env,
    ...apiLimit,
    operation: "api.v1.watchlists.runs.latest",
    actionClass: "read",
    request,
  });
  if (limitResponse) return limitResponse;

  const apiGate = await requireWorkspacePlanFeature(env, workspaceUserId, "api_access");
  if (!apiGate.ok) {
    return apiGate.response;
  }

  const watchlistId = params.watchlistId?.trim();
  if (!watchlistId) {
    return notFoundResponse();
  }

  const watchlist = await getWatchlist(env, watchlistId, workspaceUserId);
  if (!watchlist) {
    return notFoundResponse();
  }

  const run = await getLatestWatchlistRun(env, watchlist.id);
  if (!run) {
    return Response.json(
      {
        watchlist_id: watchlist.id,
        run: null,
        capture_attempts: [],
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const captureAttempts = await listCaptureAttemptsForRun(env, run);

  return Response.json(
    {
      watchlist_id: watchlist.id,
      run: {
        id: run.id,
        status: run.status,
        trigger_type: run.triggerType,
        started_at: run.startedAt,
        finished_at: run.finishedAt,
        pages_scanned: run.pagesScanned,
        page_budget: run.pageBudget,
        error_code: run.errorCode,
        error_message: run.errorMessage,
      },
      capture_attempts: captureAttempts.map((attempt) => ({
        id: attempt.id,
        status: attempt.status,
        reason_code: attempt.reasonCode,
        screenshot_artifact_key: attempt.screenshotArtifactKey,
        error_message: attempt.errorMessage,
        url_checked: attempt.urlChecked,
        checked_at: attempt.checkedAt,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function notFoundResponse() {
  return Response.json(
    {
      error: "not_found",
      message: "No watchlist was found for this key.",
    },
    {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
