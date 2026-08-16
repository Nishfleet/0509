import type { ReactNode } from "react";

import { LocalTime } from "~/components/local-time";

import { QuietLine } from "./quiet-line";

/**
 * Diff plate — brief §6.5 (R7 Neon/Figma compare framing). The signature
 * object of the product: it renders a SINGLE changed token, not an object
 * dump, with the capture time stamped on both sides.
 *
 * Proof architecture (brief §8.2): **two timestamps or no diff.** If either
 * capture time is missing the plate refuses to render and degrades to a quiet
 * line — we never imply a before/after we cannot evidence.
 *
 * Red appears nowhere in this component except the deletion (brief §4.5).
 */

export const STORED_CAPTURE_NOTE = "This is the stored capture, not a re-render.";

export const DIFF_PLATE_DEGRADE_COPY =
  "Checked. We recorded a change here but kept only one capture time, so there is no before-and-after to show yet.";

export interface DiffCapture {
  /** ISO timestamp of the capture. Missing/invalid degrades the whole plate. */
  capturedAt?: string | null;
  /** The changed token itself — a price, a headline, a CTA label. */
  value?: ReactNode | null;
  /** Quoted page copy, presented as stored capture text. */
  quote?: string | null;
  /** Mono capture note (source, capture id). */
  note?: string | null;
  /**
   * Stored capture screenshot (app-relative artifact URL). Renders only when
   * present — the caller decides whether a single side may render, so the
   * side-by-side pair stays the caller's honest claim.
   */
  imageUrl?: string | null;
}

export interface DiffPlateExtraChange {
  key: string;
  value: string;
}

export function hasCaptureTime(iso: string | null | undefined): boolean {
  if (!iso) return false;
  return !Number.isNaN(new Date(iso).getTime());
}

/**
 * THE two-timestamp gate, shared by every diff surface. A before/after may
 * only render when both capture times exist, parse, and are correctly
 * ordered — a "before" newer than its "now" is corrupt evidence, not a
 * comparison. The digest enforced ordering from day one; the watchlist gate
 * did not, so the two surfaces could disagree about the same event.
 */
export function hasOrderedCapturePair(
  beforeAt: string | null | undefined,
  nowAt: string | null | undefined,
): boolean {
  if (!hasCaptureTime(beforeAt) || !hasCaptureTime(nowAt)) return false;
  return Date.parse(beforeAt as string) < Date.parse(nowAt as string);
}

function Pane({
  capture,
  label,
  variant,
  children,
}: {
  capture: DiffCapture;
  label: string;
  variant: "before" | "now";
  children?: ReactNode;
}) {
  return (
    <div className={`f9-evidence-diff-pane is-${variant}`}>
      <span className="f9-evidence-diff-label">{label}</span>
      <span className="f9-evidence-line">
        <LocalTime iso={capture.capturedAt ?? null} />
      </span>
      <span className="f9-evidence-diff-value">
        {variant === "before" ? <s>{capture.value}</s> : <mark>{capture.value}</mark>}
      </span>
      {capture.imageUrl ? (
        <img
          alt={
            variant === "before"
              ? "The page before the change, as captured"
              : "The page after the change, as captured"
          }
          className="f9-evidence-diff-shot"
          loading="lazy"
          src={capture.imageUrl}
        />
      ) : null}
      {capture.quote ? <p className="f9-evidence-diff-quote">“{capture.quote}”</p> : null}
      {capture.note ? <p className="f9-evidence-diff-note">{capture.note}</p> : null}
      {children}
    </div>
  );
}

export function DiffPlate({
  headline,
  headingLevel = 3,
  why,
  delivery,
  field,
  caughtLabel,
  verification,
  before,
  now,
  extraChanges = [],
  actions,
  degradeStamp,
  degradeCopy = DIFF_PLATE_DEGRADE_COPY,
  className,
}: {
  /** The finding, uppercase display type, max 22ch. */
  headline: string;
  /** Fits the plate to the surrounding document outline. */
  headingLevel?: 2 | 3 | 4;
  /** One sentence of why it matters. */
  why?: string;
  /** Per-change delivery state — kept separate so exact copy stays addressable. */
  delivery?: string;
  /** What changed — "OFFER PAGE", "PRICE", "HEADLINE". */
  field: string;
  /** Ink-header left stamp, e.g. "CAUGHT 27 JUL · 06:05 UTC". */
  caughtLabel: string;
  /** Ink-header right stamp, e.g. "VERIFIED · 2 CAPTURES". */
  verification?: string;
  before: DiffCapture;
  now: DiffCapture;
  /** Further changed fields live as rows in the `now` pane, not new plates. */
  extraChanges?: readonly DiffPlateExtraChange[];
  /** Rank-2 / Rank-3 actions. Never a Rank-1 — a plate repeats. */
  actions?: ReactNode;
  degradeStamp?: ReactNode;
  degradeCopy?: string;
  className?: string;
}) {
  if (!hasCaptureTime(before.capturedAt) || !hasCaptureTime(now.capturedAt)) {
    return <QuietLine stamp={degradeStamp ?? caughtLabel} copy={degradeCopy} />;
  }

  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";

  return (
    <article className={className ? `f9-evidence-diff-plate ${className}` : "f9-evidence-diff-plate"}>
      <header className="f9-evidence-plate-header f9-evidence-micro">
        <span>
          {caughtLabel} · {field}
        </span>
        {verification ? <span className="f9-evidence-plate-header-end">{verification}</span> : null}
      </header>
      <div className="f9-evidence-diff-body">
        <Heading className="f9-evidence-diff-headline">{headline}</Heading>
        {why ? <p className="f9-evidence-diff-why">{why}</p> : null}
        {delivery ? <p className="f9-evidence-diff-delivery">{delivery}</p> : null}
        <div className="f9-evidence-diff-panes">
          <Pane capture={before} label="Before" variant="before" />
          <Pane capture={now} label="Now" variant="now">
            {extraChanges.length > 0 ? (
              <div className="f9-evidence-diff-extra">
                {extraChanges.map((change, index) => (
                  // Index key: two rows may legitimately report the same
                  // field name from different captures.
                  <span className="f9-evidence-diff-note" key={`${index}-${change.key}`}>
                    {change.key}: {change.value}
                  </span>
                ))}
              </div>
            ) : null}
          </Pane>
        </div>
        <p className="f9-evidence-diff-note">{STORED_CAPTURE_NOTE}</p>
        {actions ? <div className="f9-evidence-action-row">{actions}</div> : null}
      </div>
    </article>
  );
}
