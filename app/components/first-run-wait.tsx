import { useEffect, useState } from "react";

import { FirstRunSpine } from "~/components/first-run-spine";
import { WireEyebrow, WireHeadline } from "~/components/first-run-wire";
import type { WatchlistRunRecord } from "~/lib/types";

/**
 * WP-C2 Beat 3 — "going to press". Honesty gate (§4): the ON-THE-WIRE feed only
 * renders lines whose facts are real. The first-scan run record does not expose
 * granular live sub-step counts, so we ship the REDUCED honest feed
 * (Queued → Reading {domain} → Filing your first brief) driven purely by the
 * existing run status — no fabricated numbers, no per-line timestamps. "Reading
 * {domain} now" is shown ONLY for a running scan; a queued scan says "queued".
 */

type DispatchStatus = "done" | "now" | "pending";

/** A healthy, in-flight first scan — never a failed/skipped/delayed run. */
export function isHealthyFirstScanInFlight(run: WatchlistRunRecord | null): boolean {
  if (!run) return true; // queued, run row not yet written
  if (run.status === "running") return true;
  if (run.status === "pending") return !run.errorCode; // delayed codes -> failure UI
  return false;
}

/** Only a genuinely running scan is "reading"; everything else is still queued. */
function isReadingNow(run: WatchlistRunRecord | null): boolean {
  return run?.status === "running";
}

function DispatchLine({
  status,
  label,
  sub,
}: {
  status: DispatchStatus;
  label: string;
  sub?: string;
}) {
  return (
    <li className="f9-dispatch-line" data-status={status}>
      <span className="f9-dispatch-marker" aria-hidden="true" />
      <span className="f9-dispatch-body">
        <span className="f9-dispatch-label">{label}</span>
        {sub ? <span className="f9-dispatch-sub">{sub}</span> : null}
      </span>
    </li>
  );
}

export function DispatchFeed({
  reading,
  domain,
}: {
  reading: boolean;
  domain: string;
}) {
  const queued: DispatchStatus = reading ? "done" : "now";
  const readingStatus: DispatchStatus = reading ? "now" : "pending";
  return (
    <div className="f9-dispatch-feed">
      <p className="f9-dispatch-head">ON THE WIRE</p>
      <ul className="f9-dispatch-list">
        <DispatchLine
          label="Queued"
          status={queued}
          sub={reading ? undefined : "Next in line"}
        />
        <DispatchLine
          label={`Reading ${domain}`}
          status={readingStatus}
          sub="Their ads + landing page"
        />
        <DispatchLine label="Filing your first brief" status="pending" />
      </ul>
    </div>
  );
}

function HonestDealPanel() {
  return (
    <aside className="f9-honest-deal">
      <WireEyebrow>WHILE WE FILE</WireEyebrow>
      <h3>Sourced or it doesn&rsquo;t run.</h3>
      <p>
        Every line in your brief is backed by a screenshot, the page text, and
        the link. If nothing&rsquo;s moving, the brief says so plainly — we
        don&rsquo;t invent a story.
      </p>
    </aside>
  );
}

function LeadSkeleton() {
  return (
    <div className="f9-wire-skeleton" aria-hidden="true">
      <span className="f9-wire-skeleton-bar" style={{ width: "82%" }} />
      <span className="f9-wire-skeleton-bar" style={{ width: "64%" }} />
      <span className="f9-wire-skeleton-bar" style={{ width: "71%" }} />
    </div>
  );
}

function ElapsedSince({ startedAt }: { startedAt: string }) {
  const started = Date.parse(startedAt);
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(started)) return;
    const tick = () => {
      const seconds = Math.max(0, Math.round((Date.now() - started) / 1000));
      setLabel(
        seconds < 90
          ? `Started ${seconds}s ago`
          : `Started ${Math.round(seconds / 60)}m ago`,
      );
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [started]);

  if (!label) return null;
  return <p className="f9-wire-elapsed">{label}</p>;
}

/**
 * Beat 3 on `/app/watchlists`. Renders only for a healthy, in-flight first scan
 * during the first-run window; on any failure/delay/skip/complete it returns
 * null so the existing FirstScanBanner failure/complete UI is what shows. The
 * headline, spine sub, and feed reflect the real run status — a queued scan is
 * never dressed up as "reading now".
 */
export function FirstRunWaitArc({
  run,
  scanDomain,
}: {
  run: WatchlistRunRecord | null;
  scanDomain: string;
}) {
  if (!isHealthyFirstScanInFlight(run)) return null;
  const reading = isReadingNow(run);

  return (
    <section className="f9-wire-wait" aria-label="First brief in progress">
      <FirstRunSpine
        furthest="scan"
        scanDomain={scanDomain}
        scanPhase={reading ? "reading" : "queued"}
        variant="compact"
      />
      <div className="f9-wire-wait-head">
        <WireEyebrow>THE 5·9 WIRE · GOING TO PRESS</WireEyebrow>
        {reading ? (
          <WireHeadline before={`We're reading ${scanDomain} `} marked="now." />
        ) : (
          <WireHeadline before={`${scanDomain} is `} marked="next in line." />
        )}
        <p className="f9-wire-wait-sub">
          This takes a minute or two — close the tab if you like. Your brief
          appears here the moment the scan finishes.
        </p>
        {run?.startedAt ? <ElapsedSince startedAt={run.startedAt} /> : null}
      </div>
      <div className="f9-wire-wait-body">
        <DispatchFeed reading={reading} domain={scanDomain} />
        <HonestDealPanel />
      </div>
      <div className="f9-wire-lead-preview">
        <WireEyebrow>SETTING THE LEAD</WireEyebrow>
        <LeadSkeleton />
      </div>
    </section>
  );
}
