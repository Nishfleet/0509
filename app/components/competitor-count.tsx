import type { ReactElement } from "react";

export function CompetitorCount({ line, full }: { line: string; full: boolean }): ReactElement {
  return (
    <p data-slot="competitor-count" className="mt-2 text-body-sm text-ink-soft">
      {line}
      {full ? (
        <>
          {" "}
          <a className="underline decoration-1 underline-offset-4" href="/pricing">
            See plans
          </a>
        </>
      ) : null}
    </p>
  );
}
