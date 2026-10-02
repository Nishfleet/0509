import type { ReactElement } from "react";
import { useFetcher } from "react-router";

import { BLOCK_HEADING } from "./page-heading";
import { Monogram } from "./monogram";
import { Button } from "./ui/button";

export interface DismissedSuggestion {
  suggestionId: string;
  name: string;
  domain: string;
  dismissedAt: string;
}

function DismissedRow({ suggestion }: { suggestion: DismissedSuggestion }): ReactElement {
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line py-4">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Monogram name={suggestion.name} off />
        <div className="min-w-0">
          <p className="truncate font-display text-row-name font-bold">{suggestion.name}</p>
          <p className="truncate text-body-sm text-ink-soft">{suggestion.domain}</p>
          <p className="text-body-sm text-ink-soft">Dismissed {suggestion.dismissedAt.slice(0, 10)}</p>
        </div>
      </div>
      <fetcher.Form method="post" className="flex gap-2">
        <input type="hidden" name="intent" value="restore-suggestion" />
        <input type="hidden" name="suggestionId" value={suggestion.suggestionId} />
        <Button type="submit" variant="secondary" disabled={busy} aria-label={`Bring back ${suggestion.name}`}>
          {busy ? "Bringing back…" : "Bring back"}
        </Button>
      </fetcher.Form>
    </li>
  );
}

export function DismissedBrands({ dismissed }: { dismissed: readonly DismissedSuggestion[] }): ReactElement | null {
  if (dismissed.length === 0) return null;
  return (
    <section aria-labelledby="settings-dismissed" className="mt-10 border-t border-line pt-4">
      <h2 id="settings-dismissed" className={BLOCK_HEADING}>
        {`Competitors you dismissed (${String(dismissed.length)})`}
      </h2>
      <p className="mt-2 max-w-prose leading-[1.55]">
        We won't suggest these again. Bring one back and it returns to Possible competitors on the Competitors page.
      </p>
      <ul aria-label="Competitors you dismissed" className="mt-3 border-b border-line">
        {dismissed.map((suggestion) => (
          <DismissedRow key={suggestion.suggestionId} suggestion={suggestion} />
        ))}
      </ul>
    </section>
  );
}
