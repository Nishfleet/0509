import { lazy, Suspense, useState } from "react";
import type { ReactElement } from "react";

import type { HowRanked } from "../lib/how-ranked";

const HowRankedDialog = lazy(() =>
  import("./how-ranked-dialog").then((module) => ({ default: module.HowRankedDialog })),
);

export function HowRankedSheet({ howRanked }: { howRanked: HowRanked }): ReactElement {
  const [opened, setOpened] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        className="min-h-11 font-mono text-eyebrow text-ink-soft uppercase underline underline-offset-4"
        onClick={() => {
          setOpened(true);
        }}
      >
        How this is ranked
      </button>
      {opened ? (
        <Suspense fallback={null}>
          <HowRankedDialog
            howRanked={howRanked}
            onClose={() => {
              setOpened(false);
            }}
          />
        </Suspense>
      ) : null}
    </>
  );
}
