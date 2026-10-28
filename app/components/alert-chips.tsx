import type { ReactElement } from "react";
import { useSearchParams } from "react-router";

import { ALERT_CHIPS, isChipCapped, type AlertChipKey } from "../lib/alert-chips";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

export function AlertChips({
  chip,
  counts,
  cappedChips,
}: {
  chip: AlertChipKey;
  counts: Record<AlertChipKey, number>;
  cappedChips: readonly AlertChipKey[];
}): ReactElement | null {
  const [, setSearchParams] = useSearchParams();
  if (counts.all === 0) return null;
  return (
    <ToggleGroup
      value={[chip]}
      onValueChange={(values) => {
        const next = values.at(-1) ?? "all";
        setSearchParams(next === "all" ? {} : { kind: next }, { preventScrollReset: true });
      }}
      data-testid="alert-chips"
      className="mt-8 grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap"
    >
      {ALERT_CHIPS.filter((entry) => counts[entry.key] > 0 || entry.key === chip).map((entry) => (
        <ToggleGroupItem
          key={entry.key}
          value={entry.key}
          data-testid={"alert-chip-" + entry.key}
          className="min-h-11 rounded-none border border-line text-ink-soft hover:bg-card hover:text-ink aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-bone"
        >
          {entry.label}{" "}
          <span className="font-mono tabular-nums">
            {counts[entry.key]}
            {isChipCapped(cappedChips, entry.key) ? "+" : ""}
          </span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
