import type { ReactElement } from "react";

import { Switch } from "./ui/switch";

export type BrandSwitchState = "on" | "off" | "you";

export const ON_CONSEQUENCE =
  "Off stops the watching and the alerts. The history stays, and turning it back on picks up where it left off.";

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

function pausedLine(pausedOn: string | undefined): string {
  const date = pausedOn?.trim();
  return date ? `paused ${date} · history kept` : "paused · history kept";
}

function trackBackground(state: BrandSwitchState): string {
  if (state === "off") return "bg-card";
  if (state === "you") return "bg-green-wash";
  return "bg-green";
}

export function BrandSwitch({
  name,
  monogram,
  state,
  pausedOn,
  onChange,
}: BrandSwitchProps): ReactElement {
  const monogramText = monogram?.trim() ?? "";
  const letter = (monogramText === "" ? name.trim() : monogramText).slice(0, 1).toUpperCase();
  const operable = state !== "you";
  const checked = state !== "off";
  const label = STATE_LABEL[state];

  return (
    <div
      data-slot="brand-switch"
      data-state={state}
      className={
        state === "off"
          ? "flex min-w-0 flex-wrap items-center gap-3 border-b border-line px-[18px] py-[15px] text-ink-faint"
          : state === "you"
            ? "flex min-w-0 flex-wrap items-center gap-3 border-b border-line bg-green-wash px-[18px] py-[15px] text-ink"
            : "flex min-w-0 flex-wrap items-center gap-3 border-b border-line bg-card px-[18px] py-[15px] text-ink"
      }
    >
      <span
        data-slot="monogram"
        className={
          state === "off"
            ? "inline-grid size-[26px] shrink-0 place-items-center border-[1.5px] border-line bg-card font-display text-[0.8rem] font-extrabold text-ink-faint"
            : state === "you"
              ? "inline-grid size-[26px] shrink-0 place-items-center border-[1.5px] border-ink bg-green font-display text-[0.8rem] font-extrabold text-on-green"
              : "inline-grid size-[26px] shrink-0 place-items-center border-[1.5px] border-ink bg-card font-display text-[0.8rem] font-extrabold text-ink"
        }
      >
        {letter}
      </span>
      <span
        data-slot="chip"
        className={
          state === "off"
            ? "inline-flex min-w-0 items-center border-[1.5px] border-dashed border-line bg-card px-[11px] py-[5px] text-[0.85rem] font-medium text-ink-faint"
            : "inline-flex min-w-0 items-center border-[1.5px] border-solid border-line bg-card px-[11px] py-[5px] text-[0.85rem] font-medium text-ink"
        }
      >
        <span className="truncate">{name}</span>
      </span>
      <Switch
        checked={checked}
        disabled={!operable}
        aria-label={name}
        trackClassName={trackBackground(state)}
        onCheckedChange={(next) => {
          if (!operable) return;
          onChange?.(next ? "on" : "off");
        }}
      >
        <span data-slot="state-label" className="font-mono text-[0.66rem] tracking-[0.1em]">
          {label}
        </span>
      </Switch>
      {state === "on" ? (
        <span data-slot="consequence" className="min-w-0 max-w-full font-mono text-[0.66rem] tracking-[0.05em] text-ink-soft">
          {ON_CONSEQUENCE}
        </span>
      ) : null}
      {state === "off" ? (
        <span data-slot="consequence" className="min-w-0 max-w-full font-mono text-[0.66rem] tracking-[0.05em]">
          {pausedLine(pausedOn)}
        </span>
      ) : null}
    </div>
  );
}
