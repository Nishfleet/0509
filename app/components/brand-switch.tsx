import { cn } from "cn";

import { Switch } from "./ui/switch";

export type BrandSwitchState = "on" | "off" | "you";

const STATE_LABEL = {
  on: "ON",
  off: "OFF",
  you: "YOU",
} as const;

export interface BrandSwitchProps {
  name: string;
  monogram?: string;
  state: BrandSwitchState;
  pausedOn?: string;
  onChange?: (next: "on" | "off") => void;
}

function pausedHistoryLine(pausedOn: string | undefined): string {
  return `paused ${pausedOn ?? "today"} · history kept`;
}

export function BrandSwitch({ name, monogram, state, pausedOn, onChange }: BrandSwitchProps) {
  const letter = (monogram ?? name).slice(0, 1).toUpperCase();
  const operable = state !== "you";
  const label = STATE_LABEL[state];

  return (
    <div
      data-slot="brand-switch"
      data-state={state}
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-3 border-b border-line px-[18px] py-[15px]",
        state === "on" && "bg-card text-ink",
        state === "off" && "text-ink-faint",
        state === "you" && "bg-accent-wash text-ink",
      )}
    >
      <span
        data-slot="monogram"
        className={cn(
          "inline-grid size-[26px] shrink-0 place-items-center border-[1.5px] font-display text-[0.8rem] font-extrabold",
          state === "you" && "border-ink bg-accent text-on-accent",
          state === "off" && "border-line bg-card text-ink-faint",
          state === "on" && "border-ink bg-card text-ink",
        )}
      >
        {letter}
      </span>
      <span
        data-slot="chip"
        className={cn(
          "inline-flex min-w-0 items-center border-[1.5px] border-line bg-card px-[11px] py-[5px] text-[0.85rem] font-medium",
          state === "off" ? "border-dashed text-ink-faint" : "border-solid text-ink",
        )}
      >
        <span className="truncate">{name}</span>
      </span>
      <label
        data-slot="hit"
        className={cn(
          "inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center gap-[9px]",
          operable ? "cursor-pointer" : "cursor-default",
        )}
      >
        <Switch
          checked={state !== "off"}
          disabled={!operable}
          aria-label={`${name} ${label}`}
          className={state === "you" ? "bg-accent-wash data-checked:bg-accent-wash" : undefined}
          onCheckedChange={(checked) => {
            if (!operable) return;
            onChange?.(checked ? "on" : "off");
          }}
        />
        <span data-slot="state-label" className="font-mono text-[0.66rem] tracking-[0.1em]">
          {label}
        </span>
      </label>
      {operable ? (
        <span
          data-slot="consequence"
          className={cn(
            "min-w-0 font-mono text-[0.66rem] tracking-[0.05em]",
            state === "on" && "text-ink-soft",
          )}
        >
          {pausedHistoryLine(pausedOn)}
        </span>
      ) : null}
    </div>
  );
}
