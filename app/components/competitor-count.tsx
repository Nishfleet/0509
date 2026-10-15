import type { ReactElement } from "react";
import { Link } from "react-router";

export function CompetitorCount({ line, full }: { line: string; full: boolean }): ReactElement {
  return (
    <p data-slot="competitor-count" className="mt-2 text-body-sm text-ink-soft">
      {line}
      {full ? (
        <>
          {" "}
          <Link className="underline decoration-1 underline-offset-4" to="/pricing">
            See plans
          </Link>
        </>
      ) : null}
    </p>
  );
}
