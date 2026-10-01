import type { ReactElement } from "react";

export interface IncidentBlockProps {
  alertId: string;
  title: string;
  kind: string;
  url: string;
  openedLabel: string;
  recheckAt: string;
  recheckLabel: string;
}

export function IncidentSlot({ incident }: { incident: IncidentBlockProps | null }): ReactElement {
  return (
    <div data-testid="incident-live" aria-live="polite">
      {incident === null ? null : <IncidentBlock {...incident} />}
    </div>
  );
}

function IncidentActions({ alertId, url }: { alertId: string; url: string }): ReactElement {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-4">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-[0.75rem] tracking-[0.04em] uppercase underline"
      >
        Open your site →
      </a>
      <form method="post">
        <input type="hidden" name="intent" value="acknowledge" />
        <input type="hidden" name="alertId" value={alertId} />
        <button type="submit" className="border border-ink px-4 py-2">
          I meant to do this
        </button>
      </form>
    </div>
  );
}

export function IncidentBlock({
  alertId,
  title,
  kind,
  url,
  openedLabel,
  recheckAt,
  recheckLabel,
}: IncidentBlockProps): ReactElement {
  return (
    <section
      data-testid="incident-block"
      aria-labelledby="incident-block-title"
      className="mt-8 border border-ink p-6 shadow-[5px_5px_0_0_var(--color-red)]"
    >
      <p className="font-mono text-[0.75rem] tracking-[0.04em]">OPEN PROBLEM</p>
      <h2 id="incident-block-title" className="mt-2 font-display text-row-name font-bold [overflow-wrap:anywhere]">
        {title}
      </h2>
      <p className="mt-2 leading-[1.65]">
        We opened {url} and got {kind}. Five minutes later we tried again and got the same result, so we emailed you{" "}
        {openedLabel}.
      </p>
      <p className="mt-2 leading-[1.65]">
        We check again at <time dateTime={recheckAt}>{recheckLabel}</time> and email you once it&#x27;s fixed.
      </p>
      <IncidentActions alertId={alertId} url={url} />
      <details className="mt-4">
        <summary className="cursor-pointer">Why we flagged this</summary>
        <p className="mt-2 leading-[1.65]">
          We count your homepage as broken when it shows a server error, a page not found error (404 or 410), or does
          not load at all, two checks in a row, five minutes apart.
        </p>
      </details>
    </section>
  );
}
