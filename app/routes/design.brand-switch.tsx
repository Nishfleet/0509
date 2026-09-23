import { useState } from "react";

import { BrandChip } from "../components/brand-chip";
import { brandRowClass, BrandSwitchField, type BrandSwitchState } from "../components/brand-switch";
import { cn } from "../lib/utils";

const PAUSED_ON = new Date("2026-09-22T12:00:00Z");

function Row({ name, initial }: { name: string; initial: BrandSwitchState }) {
  const [state, setState] = useState(initial);
  return (
    <li
      data-slot="brand-switch-row"
      data-state={state}
      className={cn(
        "flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-line py-3",
        brandRowClass(state),
      )}
    >
      <BrandChip
        name={name}
        href={`/app/competitors/${name.toLowerCase()}`}
        self={state === "you"}
        off={state === "off"}
      />
      <BrandSwitchField
        state={state}
        brandName={name}
        pausedOn={state === "off" ? PAUSED_ON : null}
        onCheckedChange={(checked) => {
          setState(checked ? "on" : "off");
        }}
      />
    </li>
  );
}

export default function Page() {
  return (
    <main className="p-4">
      <ul className="flex min-w-0 flex-col">
        <Row name="Loopwell" initial="you" />
        <Row name="Kindred" initial="on" />
        <Row name="Casetta" initial="off" />
      </ul>
    </main>
  );
}
