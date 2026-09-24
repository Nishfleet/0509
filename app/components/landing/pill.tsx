import { cn } from "../../lib/utils";

export function Pill({ label, note, live = false }: { label: string; note?: string; live?: boolean }) {
  return (
    <li
      className={cn(
        "font-mono text-pill inline-block border px-2 py-1 font-medium uppercase",
        live ? "border-green-ink bg-green-wash text-green-ink" : "border-line bg-card text-ink",
      )}
    >
      {label}
      {note === undefined ? null : <span className={live ? "" : "text-ink-soft"}> · {note}</span>}
    </li>
  );
}
