import type { ReactElement } from "react";

export interface StepBarProps {
  steps: readonly string[];
  current: number;
}

export function StepBar({ steps, current }: StepBarProps): ReactElement {
  return (
    <nav
      aria-label="Onboarding progress"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[0.66rem] uppercase tracking-[0.12em] text-ink-faint"
    >
      {steps.map((label, index) => {
        const position = index + 1;
        const here = position === current;
        return (
          <span key={`${String(position)}-${label}`} className="flex items-center gap-x-2">
            {index === 0 ? null : (
              <span aria-hidden="true">{"->"}</span>
            )}
            {here ? (
              <span className="bg-accent px-[7px] py-px font-semibold text-on-accent">
                {position} {label}
              </span>
            ) : (
              <span className="font-semibold text-ink">
                {position} {label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
