import type { ReactElement } from "react";
import { Form } from "react-router";

export interface Maybe {
  suggestionId: string;
  name: string;
  domain: string;
  reason: string | null;
}

const BUTTON = "border-line text-ink-soft min-h-11 border px-3 text-sm";

export function CompetitorMaybes({ maybes }: { maybes: readonly Maybe[] }): ReactElement | null {
  if (maybes.length === 0) return null;
  return (
    <section className="mt-10">
      <h2 className="font-display text-lg font-semibold">Maybe</h2>
      <ul aria-label="Maybe" className="mt-2">
        {maybes.map((maybe) => (
          <li key={maybe.suggestionId} className="border-line flex flex-wrap items-center gap-3 border-t py-3">
            <div className="min-w-0 flex-1">
              <span className="font-semibold">{maybe.name}</span>
              <span className="text-ink-soft ml-2 text-sm">{maybe.domain}</span>
              {maybe.reason === null ? null : <p className="text-ink-soft text-sm">{maybe.reason}</p>}
            </div>
            <Form method="post" className="flex gap-2">
              <input type="hidden" name="suggestionId" value={maybe.suggestionId} />
              <button type="submit" name="intent" value="accept" aria-label={`Watch ${maybe.name}`} className={BUTTON}>
                Watch
              </button>
              <button type="submit" name="intent" value="dismiss" aria-label={`Dismiss ${maybe.name}`} className={BUTTON}>
                Dismiss
              </button>
            </Form>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AddCompetitor({ message }: { message: string | null | undefined }): ReactElement {
  return (
    <Form method="post" className="mt-10">
      <input type="hidden" name="intent" value="add" />
      <label className="flex flex-wrap items-center gap-3">
        <span className="font-display text-[1.02rem] uppercase">Add one we missed</span>
        <input
          name="competitor"
          placeholder="their website"
          aria-label="Add one we missed"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className="border-line min-w-0 flex-1 border px-3 py-2 text-[0.88rem]"
        />
      </label>
      {message ? <p role="status" className="mt-2 text-sm">{message}</p> : null}
    </Form>
  );
}
