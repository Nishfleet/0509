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
          void copy(changeSummary(change)).then((result) => {
            if (result === "copied")
              void import("./toaster").then((module) => {
                module.toastSaved("Copied for the team");
              });
          });
        }}
      >
        {state === "copied" ? "Copied" : "Copy for the team"}
      </Button>
      {state === "failed" ? (
        <p role="status" className="mt-2 text-body-sm text-ink-soft">
          Copy failed. Select the text above and copy it by hand.
        </p>
      ) : null}
    </div>
  );
}
