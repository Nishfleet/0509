import type { ReactElement } from "react";
import { Link } from "react-router";

import { BLOCK_HEADING } from "./page-heading";

const STEPS = [
  {
    href: "/app/competitors",
    title: "Add a competitor we missed",
    detail: "Any brand you already know, by its website address.",
  },
  {
    href: "/app/settings",
    title: "Choose when your brief arrives",
    detail: "Pick the day and the hour that suit you.",
  },
  {
    href: "/app/settings/agents",
    title: "Connect Claude, ChatGPT or Cursor",
    detail: "Your AI app can then read your brief and alerts.",
  },
] as const;

export function FirstWeekSteps(): ReactElement {
  return (
    <section data-home="first-week-steps" aria-labelledby="first-week-steps-heading" className="mt-10">
      <h2 id="first-week-steps-heading" className={BLOCK_HEADING}>
        While you wait
      </h2>
      <ul className="mt-2 border-b border-line">
        {STEPS.map((step) => (
          <li key={step.href} className="border-t border-line">
            <Link className="block py-4" to={step.href}>
              <span className="block font-display text-row-name font-bold underline decoration-1 underline-offset-4">
                {step.title}
              </span>
              <span className="mt-1 block text-body-sm text-ink-soft">{step.detail}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
