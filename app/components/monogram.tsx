import type { ReactElement } from "react";

import { brandMonogram } from "./brand-chip";
import { cn } from "../lib/utils";

export function Monogram({ name, self = false, off = false }: { name: string; self?: boolean; off?: boolean }): ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "font-display flex size-[26px] shrink-0 items-center justify-center border-[1.5px] text-[0.8rem] font-extrabold",
        self ? "bg-green border-ink" : "bg-card",
        off ? "border-line" : "border-ink",
      )}
    >
      {brandMonogram(name)}
    </span>
  );
}
