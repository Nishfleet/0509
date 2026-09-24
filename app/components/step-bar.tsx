import type { ReactElement } from "react";

import { cn } from "../lib/utils";

export const ONBOARDING_STEPS = ["your site", "your card", "your competitors"] as const;

export function StepBar({ current }: { current: 1 | 2 | 3 }): ReactElement {
  return (
    <nav aria-label="Onboarding progress" className="border-line border-b pb-3">
      <ol className="text-eyebrow flex flex-wrap gap-x-5 gap-y-2 font-mono uppercase">
        {ONBOARDING_STEPS.map((label, index) => {
          const step = index + 1;
          const active = step === current;
          return (
            <li
              key={label}
              aria-current={active ? "step" : undefined}
              className={cn(active ? "bg-green text-on-green px-1.5" : step < current ? "text-ink" : "text-ink-soft")}
            >
              {step} {label}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
