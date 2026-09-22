import type { ReactElement } from "react";

export type BrandSwitchState = "on" | "off" | "you";

export const ON_CONSEQUENCE =
  "Off stops the watching and the alerts. The history stays, and turning it back on picks up where it left off.";

const STATE_LABEL = {
  on: "ON",
  off: "OFF",
  you: "YOU",
} as const;

const THUMB =
  "pointer-events-none absolute top-[2px] left-[2px] size-[15px] rounded-none bg-ink transition-transform duration-[180ms] ease-[cubic-bezier(0.32,0.72,0,1)]";

export interface BrandSwitchProps {
  name: string;
  monogram?: string;
  state: BrandSwitchState;
  pausedOn?: string;
  onChange?: (next: "on" | "off") => void;
}

export function brandsStillListed<T extends { state: string }>(brands: readonly T[]): T[] {
  return brands.filter((brand) => brand.state !== "dismissed");
}

function pausedLine(pausedOn: string | undefined): string {
  const date = pausedOn?.trim();
  return date ? `paused ${date} · history kept` : "paused · history kept";
}

function trackBackground(state: BrandSwitchState): string {
  if (state === "off") return "bg-card";
  if (state === "you") return "bg-accent-wash";
  return "bg-accent";
}

export function BrandSwitch({
  name,
  monogram,
  state,
  pausedOn,
  onChange,
}: BrandSwitchProps): ReactElement {
  const letter = (monogram ?? name).trim().slice(0, 1).toUpperCase();
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
            ? "flex min-w-0 flex-wrap items-center gap-3 border-b border-line bg-accent-wash px-[18px] py-[15px] text-ink"
            : "flex min-w-0 flex-wrap items-center gap-3 border-b border-line bg-card px-[18px] py-[15px] text-ink"
      }
    >
      <span
        data-slot="monogram"
        className={
          state === "off"
            ? "inline-grid size-[26px] shrink-0 place-items-center border-[1.5px] border-line bg-card font-display text-[0.8rem] font-extrabold text-ink-faint"
            : state === "you"
              ? "inline-grid size-[26px] shrink-0 place-items-center border-[1.5px] border-ink bg-accent font-display text-[0.8rem] font-extrabold text-on-accent"
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
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={`${name} ${label}`}
        disabled={!operable}
        data-slot="hit"
        className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center gap-[9px] border-0 bg-transparent p-0 text-inherit outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-100"
        onClick={() => {
          if (!operable) return;
          onChange?.(checked ? "off" : "on");
        }}
      >
        <span
          data-slot="track"
          className={`relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-none border-[1.5px] border-ink ${trackBackground(state)}`}
        >
          <span data-slot="thumb" className={checked ? `${THUMB} translate-x-[16px]` : `${THUMB} translate-x-0`} />
        </span>
        <span data-slot="state-label" className="font-mono text-[0.66rem] tracking-[0.1em]">
          {label}
        </span>
      </button>
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
