import type { ReactElement } from "react";

import { brandMonogram } from "./brand-chip";
import { cn } from "../lib/utils";

export function Monogram({ name, self = false, off = false }: { name: string; self?: boolean; off?: boolean }): ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-[26px] shrink-0 items-center justify-center border-[1.5px] font-display text-[0.8rem] font-extrabold",
        self ? "border-ink bg-green" : "bg-card",
        off ? "border-line" : "border-ink",
      )}
    >
      {brandMonogram(name)}
    </span>
  );
}
