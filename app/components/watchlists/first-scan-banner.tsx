import { useEffect, useState } from "react";
import { useRevalidator } from "react-router";

import { SecondaryAction, TertiaryAction } from "~/components/evidence/cta";
import { firstScanPollingKey } from "~/lib/watchlist-display";
import type { WatchlistRunRecord } from "~/lib/types";

const FIRST_SCAN_FAST_POLL_LIMIT = 30; // 4s × 30 ≈ 2 minutes
const FIRST_SCAN_SLOW_POLL_LIMIT = 10; // then 30s × 10 ≈ 5 more minutes
const FIRST_SCAN_POLL_LIMIT = FIRST_SCAN_FAST_POLL_LIMIT + FIRST_SCAN_SLOW_POLL_LIMIT;

// The activation banner is driven by the durable run, never inferred from a
// missing last-scanned timestamp. Poll only while the queue can still change.
export function FirstScanBanner(props: {
  watchlistId: string;
  plan: string;
  run: WatchlistRunRecord | null;
}) {
  const revalidator = useRevalidator();
  const [pollCount, setPollCount] = useState(0);
  const shouldPoll = !props.run || props.run.status === "pending" || props.run.status === "running";
  const pollingKey = firstScanPollingKey(props);

  useEffect(() => {
    setPollCount(0);
  }, [pollingKey]);

  useEffect(() => {
    if (!shouldPoll || pollCount >= FIRST_SCAN_POLL_LIMIT) {
      return;
    }

    // WP-40: fast poll first, then back off to 30s so a scan finishing at
    // minute 3–4 still surfaces without a manual refresh.
    const intervalMs = pollCount < FIRST_SCAN_FAST_POLL_LIMIT ? 4000 : 30_000;
    const timer = setTimeout(() => {
      setPollCount((count) => count + 1);
      if (revalidator.state === "idle") {
        revalidator.revalidate();
      }
    }, intervalMs);
    return () => clearTimeout(timer);
  }, [pollCount, revalidator, shouldPoll]);

  const delayed =
    props.run?.status === "pending" &&
    [
      "dispatch_rate_limited",
      "first_scan_dispatch_failed",
      "first_scan_setup_failed",
      "workflow_binding_missing",
    ].includes(props.run.errorCode ?? "");
  // The calm "safely paused" state keys off the SEMANTIC (a provider
  // network denial skipped the scan), not off the e2e fixture's exact code —
  // product copy must never be shaped by a fixture-only identifier.
  const safelyPaused =
    props.run?.status === "skipped" &&
    Boolean(props.run.errorCode?.endsWith("provider_network_denied"));
  const completed = props.run?.status === "succeeded";
  const failed = props.run?.status === "failed";
  const skipped = props.run?.status === "skipped" && !safelyPaused;
  const timedOut = shouldPoll && pollCount >= FIRST_SCAN_POLL_LIMIT;
  const pastFastPoll = shouldPoll && pollCount >= FIRST_SCAN_FAST_POLL_LIMIT && !timedOut;
  const scanLabel = props.plan === "free" ? "Activation scan" : "First scan";

  const heading = safelyPaused
    ? `${scanLabel} safely paused`
    : completed
      ? `${scanLabel} complete`
    : failed
      ? `${scanLabel} needs attention`
      : skipped
        ? `${scanLabel} did not run`
        : delayed || timedOut || !props.run
          ? `${scanLabel} delayed`
          : props.run.status === "running"
            ? "Scanning this competitor now…"
            : `${scanLabel} starts shortly`;

  const message = safelyPaused
    ? "Provider access is disabled in this local release proof. No external check was attempted."
    : completed
      ? "The first scan is ready. Review the proof below before deciding what to monitor next."
    : failed
      ? "We couldn't finish this check. Check Source access, and email support if the next attempt fails too."
      : skipped
        ? "This check stopped safely before results were saved. Recent checks shows what happened and what runs next."
        : delayed || timedOut || !props.run
          ? props.plan === "free"
            ? "The activation scan hit a delay, so we're retrying it automatically. After activation, free checks weekly; paid plans check every 3–6 hours."
            : "The first scan hit a delay, so we're retrying it automatically. Your next scheduled scan is unaffected."
          : props.run.status === "running"
            ? props.plan === "free"
              ? "Your activation scan is running. This page updates by itself when results are ready. After this, free checks weekly; paid plans check every 3–6 hours."
              : "Your first scan is running. This page updates by itself when results are ready."
            : props.plan === "free"
              ? "The activation scan is in line and starts automatically. This page updates by itself."
              : "Your first scan is in line and starts automatically. This page updates by itself.";

  return (
    <article
      className={`f9-evidence-first-scan ${failed || skipped ? "is-error" : completed ? "is-success" : "is-pending"}`}
      aria-live="polite"
      role="status"
    >
      <header className="f9-evidence-first-scan-header f9-evidence-micro">
        {props.plan === "free" ? "Activation scan" : "First scan"}
      </header>
      <div className="f9-evidence-first-scan-body">
        <h2 className="f9-evidence-first-scan-headline">
          {props.run?.status === "running" ? (
            <span className="f9-checkout-pulse" aria-hidden="true" />
          ) : null}
          {heading}
        </h2>
        <p className="f9-evidence-first-scan-copy">{message}</p>
        <div className="f9-evidence-action-row">
          {failed ? <TertiaryAction to="/app/source-access">Check source access</TertiaryAction> : null}
          {(pastFastPoll || timedOut) && shouldPoll ? (
            <>
              <SecondaryAction
                small
                onClick={() => {
                  if (revalidator.state === "idle") {
                    revalidator.revalidate();
                  }
                }}
              >
                Check now
              </SecondaryAction>
              {pastFastPoll && !timedOut ? (
                <span className="f9-evidence-line">
                  Still waiting — checking every 30 seconds.
                </span>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </article>
  );
}
