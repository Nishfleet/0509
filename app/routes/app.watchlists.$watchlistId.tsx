import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";

import { DashboardPage } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { LocalTime } from "~/components/local-time";
import { RuledList, RuledRow } from "~/components/workspace/ruled-list";
import { WorkingHeader } from "~/components/workspace/working-header";
import {
  formatCaptureAttemptReasonLabel,
  type CaptureAttemptStatus,
} from "~/lib/capture-attempt-reason-code";
import type { WatchlistRecord, WatchlistRunRecord } from "~/lib/types";

/**
 * `/app/watchlists/:watchlistId` — run history for one competitor (issue #1476).
 *
 * The capture-validity gate (BET 4) makes "if we send it, the page really
 * changed" provable — but the gate's failures were only visible through the
 * Agency `/api/v1` endpoint. This page is the standard signed-in surface that
 * lists every URL the latest check touched, with a human label for each
 * failed or skipped capture and the reason nothing was sent. A failed capture
 * is never an alert, but it is never hidden either.
 *
 * Signed-in workspace session only — no Agency plan and no customer API key,
 * the same ownership check the competitor detail uses. Read-only: no live
 * scraping is triggered; the loader reads existing `proof_capture` rows.
 * Internal `landing_*` / `skipped_due_to_*` tokens never leave the server;
 * the render shows only the public reason label.
 */

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => [
  {
    title: loaderData?.watchlist
      ? `${loaderData.watchlist.name} — run history | Watch | Five to Nine`
      : "Watch | Five to Nine",
  },
];

export function HydrateFallback() {
  return <DashboardRouteLoading title="Watch" />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return <DashboardRouteError error={error} />;
}

/** A serializable subset of `CaptureAttempt` — labels, never tokens. */
export type RunHistoryCaptureAttempt = {
  id: string;
  status: CaptureAttemptStatus;
  /** Human label for non-succeeded captures; `null` when none applies. */
  reasonLabel: string | null;
  urlChecked: string | null;
  checkedAt: string;
};

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { requireWorkspaceSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { getWatchlist } = await import("~/lib/data.server");
  const { getLatestWatchlistRun } = await import("~/lib/data/watchlist-runs.server");
  const { listCaptureAttemptsForRun } = await import(
    "~/lib/data/watchlist-run-capture-attempts.server"
  );

  const env = getEnv(context);
  const { workspaceUserId } = await requireWorkspaceSession(env, request);

  const watchlistId = params.watchlistId?.trim();
  const watchlist = watchlistId
    ? await getWatchlist(env, watchlistId, workspaceUserId)
    : null;
  if (!watchlist) {
    throw new Response("Not found", { status: 404 });
  }

  const run = await getLatestWatchlistRun(env, watchlist.id);
  const captureAttempts = run
    ? await listCaptureAttemptsForRun(env, run).catch(() => [] as RunHistoryCaptureAttempt[])
    : [];

  return {
    watchlist,
    run: run ? toRenderRun(run) : null,
    captureAttempts: captureAttempts.map((attempt) => ({
      id: attempt.id,
      status: attempt.status,
      reasonLabel:
        attempt.status === "succeeded"
          ? null
          : formatCaptureAttemptReasonLabel(attempt.reasonCode),
      urlChecked: attempt.urlChecked,
      checkedAt: attempt.checkedAt,
    })),
  };
}

function toRenderRun(run: WatchlistRunRecord) {
  return {
    id: run.id,
    status: run.status,
    pagesScanned: run.pagesScanned,
    pageBudget: run.pageBudget,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

const RUN_STATUS_LABELS: Record<WatchlistRunRecord["status"], string> = {
  pending: "Waiting to run",
  running: "Running now",
  succeeded: "Succeeded",
  failed: "Didn't finish",
  skipped: "Skipped",
};

const ATTEMPT_STATUS_LABELS: Record<CaptureAttemptStatus, string> = {
  succeeded: "Captured",
  capture_failed: "Check failed",
  skipped_due_to_budget: "Skipped",
};

export default function WatchlistRunHistoryRoute() {
  const data = useLoaderData<typeof loader>();
  const { watchlist, run, captureAttempts } = data;

  return (
    <DashboardPage className="f9-wk-page f9-watchdetail-page f9-rh-page">
      <WorkingHeader
        title={watchlist.name}
        context={
          <>
            <Link className="f9-watchdetail-back" to="/app/watchlists">
              All competitors
            </Link>
            <span aria-hidden="true"> &rsaquo; </span>
            {watchlist.targetLabel} · Run history
          </>
        }
      />

      <section aria-labelledby="run-history-title" className="f9-wk-sec">
        <p className="f9-wk-kick" id="run-history-title">
          Run history
        </p>
        <p className="f9-wk-lede">
          Every URL the latest check touched is listed below — including checks that did
          not produce an alert, with the reason why. A failed check is never an alert,
          but it is never hidden either.
        </p>

        {run ? (
          <p className="f9-rh-run-line">
            <strong>{RUN_STATUS_LABELS[run.status]}</strong> · {run.pagesScanned} of{" "}
            {run.pageBudget} pages checked ·{" "}
            <LocalTime iso={run.finishedAt ?? run.startedAt} />
          </p>
        ) : (
          <p className="f9-wk-dim">
            No checks yet — the first one shows up here automatically.
          </p>
        )}

        {captureAttempts.length > 0 ? (
          <RuledList flush aria-label="Capture attempts in the latest check" role="list">
            {captureAttempts.map((attempt) => (
              <RuledRow
                key={attempt.id}
                plain
                role="listitem"
                name={attempt.urlChecked?.trim() ? shortenUrl(attempt.urlChecked!) : "—"}
                status={ATTEMPT_STATUS_LABELS[attempt.status]}
                statusTone={
                  attempt.status === "succeeded"
                    ? "on"
                    : attempt.status === "capture_failed"
                      ? "bad"
                      : "quiet"
                }
                say={formatAttemptSay(attempt.reasonLabel, attempt.status)}
                time={<LocalTime iso={attempt.checkedAt} />}
                off={attempt.status !== "succeeded"}
              />
            ))}
          </RuledList>
        ) : run ? (
          <p className="f9-wk-dim">This check touched no URLs.</p>
        ) : null}
      </section>

      <section className="f9-wk-sec" aria-label="What this page means">
        <p className="f9-wk-dim">
          This is the same record the capture rules promise. When a check is blocked or
          skipped, the reason is listed here instead of being silently dropped — so a
          quiet week is provable: we checked, the page blocked us, and nothing was missed.
        </p>
      </section>
    </DashboardPage>
  );
}

function formatAttemptSay(
  reasonLabel: string | null,
  status: CaptureAttemptStatus,
): string {
  if (status === "succeeded") {
    return "Captured without issue.";
  }
  const reason = reasonLabel ?? "Check did not produce an alert";
  return `${reason}. No alert sent.`;
}

export function shortenUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.host}${path}`;
  } catch {
    return url.length > 60 ? `${url.slice(0, 57)}…` : url;
  }
}