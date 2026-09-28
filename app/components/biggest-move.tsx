import type { ReactElement } from "react";

import { EmptyState } from "./empty-state";
import { SiteChangeItem } from "./site-change-item";
import type { SiteChangeItemData } from "./site-change-item";
import type { BiggestMoveView } from "../lib/biggest-move";
import { httpUrl } from "../lib/http-url";

export interface BiggestMoveProps {
  move: BiggestMoveView | null;
  change: SiteChangeItemData | null;
  quiet: string;
}

export function BiggestMove({ move, change, quiet }: BiggestMoveProps): ReactElement {
  if (move === null) {
    return <EmptyState sentence={quiet} />;
  }
  const read = (
    <p data-slot="biggest-move-read" className="mt-3 max-w-prose leading-[1.65]">
      {move.read}
    </p>
  );
  if (move.kind === "change" && change !== null) {
    return (
      <>
        <SiteChangeItem change={change} size="lg" eager />
        {read}
      </>
    );
  }
  const href = move.url === null ? null : httpUrl(move.url);
  return (
    <article data-testid="biggest-move" className="border-line mt-8 min-w-0 border-t pt-6">
      <h3 className="font-display text-row-name font-bold [overflow-wrap:anywhere]">
        {move.title}
      </h3>
      <p className="text-ink-soft mt-2 font-mono text-meta uppercase">
        {move.source} · {move.when}
      </p>
      {href === null ? null : (
        <a href={href} rel="noopener noreferrer" target="_blank" className="underline">
          Open the source
        </a>
      )}
      {read}
    </article>
  );
}
