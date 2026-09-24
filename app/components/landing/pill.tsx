import { cn } from "../../lib/utils";

export function Pill({ label, note, highlight = false }: { label: string; note?: string; highlight?: boolean }) {
  return (
    <li
      className={cn(
        "font-mono text-pill inline-block border px-2 py-1 font-medium uppercase",
        highlight ? "border-green-ink bg-green-wash text-green-ink" : "border-line bg-card text-ink",
      )}
    >
      {label}
      {note === undefined ? null : <span className={highlight ? "" : "text-ink-soft"}> · {note}</span>}
    </li>
  );
}
