import type { ReactElement } from "react";

import { BLOCK_HEADING } from "./page-heading";
import { Monogram } from "./monogram";
import { Button } from "./ui/button";

export interface DismissedSuggestion {
  suggestionId: string;
  name: string;
  domain: string;
  dismissedAt: string;
}

export function DismissedBrands({ dismissed }: { dismissed: readonly DismissedSuggestion[] }): ReactElement | null {
  if (dismissed.length === 0) return null;
  return (
    <section aria-labelledby="settings-dismissed" className="border-line mt-10 border-t pt-4">
      <h2 id="settings-dismissed" className={BLOCK_HEADING}>
        Brands you dismissed
      </h2>
      <p className="mt-2 max-w-prose leading-[1.55]">
        We won't suggest these again. Bring one back and it returns to your maybes on Competitors.
      </p>
      <ul aria-label="Brands you dismissed" className="border-line mt-3 border-b">
        {dismissed.map((suggestion) => (
          <li
            key={suggestion.suggestionId}
            className="border-line flex flex-wrap items-center gap-x-4 gap-y-2 border-t py-4"
          >
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <Monogram name={suggestion.name} off />
              <div className="min-w-0">
                <p className="font-display text-row-name truncate font-bold">{suggestion.name}</p>
                <p className="text-ink-soft truncate text-body-sm">{suggestion.domain}</p>
                <p className="text-ink-soft text-body-sm">Dismissed {suggestion.dismissedAt.slice(0, 10)}</p>
              </div>
            </div>
            <form method="post" className="flex gap-2">
              <input type="hidden" name="intent" value="restore-suggestion" />
              <input type="hidden" name="suggestionId" value={suggestion.suggestionId} />
              <Button type="submit" variant="secondary" aria-label={`Bring back ${suggestion.name}`}>
                Bring back
              </Button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
