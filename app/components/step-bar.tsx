import type { ReactElement } from "react";

export const ONBOARDING_STEPS = ["your site", "your card", "your competitors"] as const;

export function StepBar({ current }: { current: 1 | 2 | 3 }): ReactElement {
  return (
    <nav aria-label="Onboarding progress">
      <ol className="flex gap-4 font-mono text-[0.75rem] uppercase">
        {ONBOARDING_STEPS.map((label, index) => {
          const step = index + 1;
          const active = step === current;
          return (
            <li
              key={label}
              {...(active ? { "aria-current": "step" as const } : {})}
              className={active ? "border-b-2 border-current" : "opacity-60"}
            >
              {step} {label}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
