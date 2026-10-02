import type { ReactElement } from "react";
import { Form, useNavigation } from "react-router";

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
  const navigation = useNavigation();
  const acknowledging = navigation.state !== "idle" && navigation.formData?.get("alertId") === alertId;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-4">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center font-mono text-[0.75rem] tracking-[0.04em] uppercase underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink focus-visible:outline-solid"
      >
        Open your site →
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
      <Form method="post">
        <input type="hidden" name="intent" value="acknowledge" />
        <input type="hidden" name="alertId" value={alertId} />
        <button
          type="submit"
          disabled={acknowledging}
          className="min-h-11 border border-ink px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink focus-visible:outline-solid"
        >
          {acknowledging ? "Saving…" : "I meant to do this"}
        </button>
      </Form>
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
        <summary className="flex min-h-11 cursor-pointer items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink focus-visible:outline-solid">
          Why we flagged this
        </summary>
        <p className="mt-2 leading-[1.65]">
          We count your homepage as broken when it shows a server error, a page not found error (404 or 410), or does
          not load at all, two checks in a row, five minutes apart.
        </p>
      </details>
    </section>
  );
}
