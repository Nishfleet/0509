import type { ReactElement } from "react";

import { changeSummary, type SummarisableChange } from "../lib/change-summary";
import { useCopyState } from "../lib/use-copy-state";
import { Button } from "./ui/button";

export function CopyChangeButton({ change }: { change: SummarisableChange }): ReactElement {
  const [state, copy] = useCopyState();
  return (
    <div className="mt-3">
      <Button
        type="button"
        data-testid="copy-change"
        variant="secondary"
        onClick={() => {
          void copy(changeSummary(change));
        }}
      >
        {state === "copied" ? "Copied" : "Copy for the team"}
      </Button>
      <p role="status" className="mt-2 text-body-sm text-ink-soft">
        {state === "copied" ? "Copied for the team." : null}
        {state === "failed" ? "Copy failed. Select the text above and copy it by hand." : null}
      </p>
    </div>
  );
}
