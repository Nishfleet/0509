import type { ReactElement } from "react";

import { cn } from "../lib/utils";

export const ONBOARDING_STEPS = ["Your site", "Check details", "Competitors"] as const;

export function StepBar({ current }: { current: 1 | 2 | 3 }): ReactElement {
  return (
    <nav aria-label="Onboarding progress" className="border-b border-line pb-3">
      <ol className="flex flex-wrap gap-x-5 gap-y-2 font-mono text-eyebrow uppercase">
        {ONBOARDING_STEPS.map((label, index) => {
          const step = index + 1;
          const active = step === current;
          return (
            <li
              key={label}
              aria-current={active ? "step" : undefined}
              className={cn(active ? "bg-green px-1.5 text-on-green" : step < current ? "text-ink" : "text-ink-soft")}
            >
              {step} {label}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
