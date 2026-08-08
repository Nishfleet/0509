import type { ReactNode } from "react";

import { LocalTime } from "~/components/local-time";

import { FactRail, type FactRow } from "./fact-rail";

/**
 * Evidence plate — brief §6.9 (R3 report discipline + R7 capture framing).
 *
 * Numbered, stamped, quotable. Plates are numbered sequentially across the
 * whole report and referenced BY NUMBER in the prose (R4) — that is what
 * makes a report quotable in a client email.
 *
 * Honest degrade: an unreadable capture still renders its frame with one
 * muted sentence (R5), and an unrecorded capture time says so rather than
 * printing a plausible one (brief §8.1).
 */

export const UNREADABLE_CAPTURE_COPY = "We could not read this one.";

export const MISSING_CAPTURE_TIME_LABEL = "capture time not recorded";

export function formatPlateNumber(value: number): string {
  return String(Math.max(0, Math.trunc(value))).padStart(2, "0");
}

export function EvidencePlate({
  number,
  title,
  headline,
  headingLevel = 3,
  why,
  verification,
  capturedAt,
  capture,
  captureLines,
  facts,
  footnote,
  className,
}: {
  /** Sequential across the whole report; printed as 01, 02, … */
  number: number;
  /** What the plate shows — "OFFER PAGE", "AD CREATIVE". */
  title: string;
  /**
   * The finding this plate evidences, in display type. Optional: a plate that
   * is purely a capture (no finding to state) renders without one rather than
   * inventing a headline.
   */
  headline?: string;
  /** Fits the plate to the surrounding document outline. */
  headingLevel?: 2 | 3 | 4;
  /** One sentence of why this plate matters. Rendered once, never repeated. */
  why?: string;
  /** "VERIFIED", "SAMPLE", "DEMO DATA — SAMPLE RESULTS" (brief §8.3). */
  verification?: string;
  capturedAt?: string | null;
  /** The stored capture itself (an image we took), above its text lines. */
  capture?: ReactNode;
  /** Lines of the stored capture, rendered inside the mock frame. */
  captureLines?: readonly string[];
  /** Edited down to what an agency would quote (max 8, brief §6.6). */
  facts: readonly FactRow[];
  /** The provenance sentence. */
  footnote?: string;
  className?: string;
}) {
  const lines = (captureLines ?? []).filter((line) => line.trim().length > 0);
  const stamp = capturedAt && !Number.isNaN(new Date(capturedAt).getTime());
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";

  return (
    <article className={className ? `f9-evidence-plate ${className}` : "f9-evidence-plate"}>
      <header className="f9-evidence-plate-header f9-evidence-micro">
        <span>
          PLATE {formatPlateNumber(number)} — {title}
          {verification ? ` · ${verification}` : ""}
        </span>
        <span className="f9-evidence-plate-header-end">
          {stamp ? <LocalTime iso={capturedAt} /> : MISSING_CAPTURE_TIME_LABEL}
        </span>
      </header>
      {headline ? <Heading className="f9-evidence-headline">{headline}</Heading> : null}
      {why ? <p className="f9-evidence-why">{why}</p> : null}
      <div className="f9-evidence-body">
        <div className="f9-evidence-capture">
          <div className="f9-evidence-mock-frame">
            {capture}
            {lines.length > 0 ? (
              lines.map((line, index) => (
                // Index key: a stored capture can repeat a line verbatim.
                <p className="f9-evidence-mock-line" key={`${index}-${line}`}>
                  {line}
                </p>
              ))
            ) : capture ? null : (
              <p className="f9-evidence-mock-empty">{UNREADABLE_CAPTURE_COPY}</p>
            )}
          </div>
        </div>
        <div className="f9-evidence-side">
          <FactRail rows={facts} />
        </div>
      </div>
      {footnote ? <p className="f9-evidence-footnote">{footnote}</p> : null}
    </article>
  );
}
