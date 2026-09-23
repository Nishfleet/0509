import type { ReactElement } from "react";

import { Form } from "react-router";

export interface OnCompetitorRow {
  id: string;
  name: string;
  domain: string;
  reason: string | null;
}

export interface MaybeCompetitorRow {
  id: string;
  name: string;
  domain: string;
  reason: string | null;
  p: number | null;
}

function SwitchGlyph({ on }: { on: boolean }): ReactElement {
  return (
    <span
      aria-hidden="true"
      className={`flex h-[22px] w-[38px] items-center border border-ink px-[2px] ${on ? "bg-green" : "bg-card"}`}
    >
      <span className={`block h-[16px] w-[16px] bg-ink ${on ? "ml-auto" : ""}`} />
    </span>
  );
}

export function OnCompetitorList({ rows }: { rows: readonly OnCompetitorRow[] }): ReactElement {
  return (
    <ul className="border-b border-line">
      {rows.map((competitor) => (
        <li key={competitor.id} data-entity-id={competitor.id} className="border-t border-line py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="font-display text-row-name font-bold text-ink">{competitor.name}</p>
              <p className="font-mono text-meta text-ink-faint">{competitor.domain}</p>
            </div>
            <span className="flex shrink-0 items-center gap-2">
              <SwitchGlyph on />
              <span className="font-mono text-pill font-semibold uppercase tracking-[0.08em] text-ink">ON</span>
            </span>
          </div>
          {competitor.reason ? (
            <p className="mt-2 font-sans text-body-sm text-ink-soft">{competitor.reason}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function MaybeCompetitorList({ rows }: { rows: readonly MaybeCompetitorRow[] }): ReactElement {
  return (
    <section aria-label="Maybe competitors">
      <h2 className="font-mono text-eyebrow uppercase tracking-[0.16em] text-ink-faint">Maybe</h2>
      <ul className="mt-3 border-b border-line">
        {rows.map((maybe) => (
          <li key={maybe.id} data-suggestion-id={maybe.id} className="border-t border-line bg-bone px-3 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="font-display text-row-name font-bold text-ink-soft">{maybe.name}</p>
                <p className="font-mono text-meta text-ink-faint">{maybe.domain}</p>
              </div>
              <Form method="post" className="flex shrink-0 items-center">
                <input type="hidden" name="suggestionId" value={maybe.id} />
                <button
                  type="submit"
                  name="intent"
                  value="accept"
                  aria-label={`Turn on ${maybe.name}`}
                  className="flex items-center gap-2"
                >
                  <SwitchGlyph on={false} />
                  <span className="font-mono text-pill font-semibold uppercase tracking-[0.08em] text-ink-soft">OFF</span>
                </button>
              </Form>
            </div>
            {maybe.reason ? (
              <p className="mt-2 font-sans text-body-sm text-ink-soft">{maybe.reason}</p>
            ) : null}
            {maybe.p !== null ? (
              <p className="mt-1 font-mono text-meta text-ink-faint">p {maybe.p.toFixed(2)}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
