import type { ReactElement } from "react";
import { useSearchParams } from "react-router";

import { ALERT_CHIPS, type AlertChipKey } from "../lib/alert-chips";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

export function AlertChips({
  chip,
  counts,
  hiringCapped,
}: {
  chip: AlertChipKey;
  counts: Record<AlertChipKey, number>;
  hiringCapped: boolean;
}): ReactElement {
  const [, setSearchParams] = useSearchParams();
  return (
    <ToggleGroup
      value={[chip]}
      onValueChange={(values) => {
        const next = values.at(-1) ?? "all";
        setSearchParams(next === "all" ? {} : { kind: next }, { preventScrollReset: true });
      }}
      data-testid="alert-chips"
      className="mt-8 flex w-full flex-wrap gap-2"
    >
      {ALERT_CHIPS.map((entry) => (
        <ToggleGroupItem
          key={entry.key}
          value={entry.key}
          data-testid={"alert-chip-" + entry.key}
          disabled={counts[entry.key] === 0 && entry.key !== chip}
          className="min-h-11 rounded-none border border-line text-ink-soft hover:bg-card hover:text-ink aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-bone"
        >
          {entry.label}{" "}
          <span className="font-mono tabular-nums">
            {counts[entry.key]}
            {entry.key === "hiring" && hiringCapped ? "+" : ""}
          </span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
