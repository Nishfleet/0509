import type { ReactElement } from "react";

import type { FirstLookRow } from "../lib/first-look";
import { BLOCK_HEADING } from "./page-heading";

export function FirstLook({ rivals }: { rivals: readonly FirstLookRow[] }): ReactElement | null {
  if (rivals.length === 0) return null;
  return (
    <section data-home="first-look" aria-labelledby="first-look-heading" className="mt-10">
      <h2 id="first-look-heading" className={BLOCK_HEADING}>
        Where your rivals stand today
      </h2>
      <ul className="mt-2 border-b border-line">
        {rivals.map((rival) => (
          <li
            key={rival.id}
            className="flex flex-wrap items-baseline justify-between gap-x-4 border-t border-line py-3"
          >
            <span className="min-w-0 font-display text-row-name font-bold [overflow-wrap:anywhere]">{rival.name}</span>
            <span className="text-body-sm text-ink-soft">{rival.line}</span>
            {(rival.facts ?? []).map((fact) => (
              <p key={fact} className="basis-full pt-1 text-body-sm text-ink-soft">
                {fact}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
