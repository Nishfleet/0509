import type { ReactElement } from "react";

import type { PricingStep } from "../lib/pricing-timeline";

export function PricingTimeline({ steps }: { steps: readonly PricingStep[] }): ReactElement | null {
  if (steps.length === 0) return null;
  return (
    <section data-section="pricing-timeline" aria-labelledby="competitor-pricing-timeline" className="min-w-0">
      <h2 id="competitor-pricing-timeline" className="mb-3 font-mono text-eyebrow text-ink-soft uppercase">
        Pricing page over time
      </h2>
      <ol className="border-t border-ink">
        {steps.map((step) => (
          <li key={step.id} className="border-b border-line py-3">
            <time dateTime={step.day} className="block font-mono text-meta text-ink-soft uppercase">
              {step.day}
            </time>
            <p className="mt-1 leading-[1.65] [overflow-wrap:anywhere]">
              <span className="sr-only">Was </span>
              <span className="text-ink-soft line-through">{step.from}</span>
              <span aria-hidden="true"> → </span>
              <span className="sr-only">, now </span>
              {step.to}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
