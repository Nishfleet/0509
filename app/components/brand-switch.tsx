import type { ReactElement } from "react";

import { Switch } from "./ui/switch";

export type BrandSwitchState = "on" | "off" | "you";

const STATE_TEXT: Record<BrandSwitchState, string> = {
  on: "ON",
  off: "OFF",
  you: "YOU",
};

export function BrandSwitch({
  state,
  brandName,
  onCheckedChange,
}: {
  state: BrandSwitchState;
  brandName: string;
  onCheckedChange?: (checked: boolean) => void;
}): ReactElement {
  return (
    <label
      data-slot="brand-switch"
      data-state={state}
      className="inline-flex min-h-11 min-w-11 cursor-pointer items-center gap-2 font-mono text-[0.7rem] tracking-[0.08em] text-ink uppercase data-[state=you]:cursor-default"
    >
      <Switch
        checked={state !== "off"}
        disabled={state === "you"}
        aria-label={`${brandName} tracking`}
        onCheckedChange={(checked) => onCheckedChange?.(checked)}
        className="h-[22px] w-[38px] shrink-0 rounded-none border-[1.5px] border-ink bg-card data-checked:bg-green data-disabled:bg-green-wash data-disabled:opacity-100 [&_[data-slot=switch-thumb]]:size-4 [&_[data-slot=switch-thumb]]:rounded-none [&_[data-slot=switch-thumb]]:bg-ink [&_[data-slot=switch-thumb]]:transition-transform [&_[data-slot=switch-thumb]]:duration-180 [&_[data-slot=switch-thumb]]:translate-x-[1.5px] data-checked:[&_[data-slot=switch-thumb]]:translate-x-[17.5px]"
      />
      <span>{STATE_TEXT[state]}</span>
    </label>
  );
}
