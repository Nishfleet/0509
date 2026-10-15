import type { ReactElement } from "react";
import { Link } from "react-router";

import { nudgeLine } from "../lib/rival-nudge";

export function RivalNudge({ rivals }: { rivals: number }): ReactElement {
  return (
    <p data-home="rival-nudge" className="mt-6 text-[0.88rem] text-ink-soft">
      {nudgeLine(rivals)}{" "}
      <Link
        className="inline-flex min-h-11 items-center underline decoration-1 underline-offset-4"
        to="/app/competitors"
      >
        Add a competitor
      </Link>
    </p>
  );
}
