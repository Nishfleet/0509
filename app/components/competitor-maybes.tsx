import type { ReactElement } from "react";
import { Form, useNavigation } from "react-router";

import { BLOCK_HEADING } from "./page-heading";
import { Monogram } from "./monogram";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export interface Maybe {
  suggestionId: string;
  name: string;
  domain: string;
  reason: string | null;
}

export function CompetitorMaybes({ maybes }: { maybes: readonly Maybe[] }): ReactElement | null {
  if (maybes.length === 0) return null;
  return (
    <section aria-labelledby="maybes-heading" className="mt-12">
      <h2 id="maybes-heading" className={BLOCK_HEADING}>
        Maybe
      </h2>
      <p className="text-ink-soft mt-1 text-body-sm">We weren't sure about these. Watch the ones that matter.</p>
      <ul aria-label="Maybe" className="border-line mt-3 border-b">
        {maybes.map((maybe) => (
          <li key={maybe.suggestionId} className="border-line flex flex-wrap items-center gap-x-4 gap-y-2 border-t py-4">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <Monogram name={maybe.name} off />
              <div className="min-w-0">
                <p className="font-display text-row-name truncate font-bold">{maybe.name}</p>
                <p className="text-ink-soft truncate text-body-sm">{maybe.domain}</p>
                {maybe.reason === null ? null : <p className="text-ink-soft mt-1 text-body-sm">{maybe.reason}</p>}
              </div>
            </div>
            <Form method="post" className="flex gap-2">
              <input type="hidden" name="suggestionId" value={maybe.suggestionId} />
              <Button type="submit" variant="secondary" name="intent" value="accept" aria-label={`Watch ${maybe.name}`}>
                Watch
              </Button>
              <Button
                type="submit"
                variant="tertiary"
                name="intent"
                value="dismiss"
                aria-label={`Dismiss ${maybe.name}`}
                className="px-2"
              >
                Dismiss
              </Button>
            </Form>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AddCompetitor({ message }: { message: string | null | undefined }): ReactElement {
  const navigation = useNavigation();
  const adding = navigation.state !== "idle" && navigation.formData?.get("intent") === "add";
  return (
    <Form method="post" className="mt-12">
      <input type="hidden" name="intent" value="add" />
      <label htmlFor="add-competitor" className={BLOCK_HEADING}>
        Add one we missed
      </label>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <Input
          id="add-competitor"
          name="competitor"
          placeholder="their website"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          className="sm:flex-1"
        />
        <Button type="submit" variant="secondary" size="lg" disabled={adding}>
          {adding ? "Adding…" : "Add"}
        </Button>
      </div>
      {message ? (
        <p role="status" className="mt-3 text-[0.95rem]">
          {message}
        </p>
      ) : null}
    </Form>
  );
}
