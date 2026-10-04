import type { ReactElement } from "react";

import { BLOCK_HEADING } from "./page-heading";

const CONTENTS = [
  "Where you stand this week against the brands you watch.",
  "The three things worth knowing.",
  "The proof behind each one: screenshots and links, one tap away.",
] as const;

export function FirstBriefNote({ arrivesAt }: { arrivesAt: string | null }): ReactElement {
  const arrival =
    arrivesAt === null
      ? "Your first brief arrives with your first full week of tracking"
      : `Your first brief arrives ${arrivesAt}`;
  return (
    <div data-brief="first">
      <div className="border border-line p-4">
        <p className="max-w-prose text-[0.88rem] leading-[1.5]">{arrival}. It will appear here and in your inbox.</p>
      </div>
      <h2 className={`${BLOCK_HEADING} mt-8`}>What's in it</h2>
      <ul className="mt-2 border-b border-line">
        {CONTENTS.map((line) => (
          <li key={line} className="border-t border-line py-3 leading-[1.55]">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}
