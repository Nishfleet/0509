import { PLANS, TRIAL_TERMS } from "../../lib/billing/plans";
import { planIncludes } from "../../lib/billing/plan-includes";
import { planStartHref, type StartSource } from "../../lib/pricing-page";
import { cn } from "../../lib/utils";
import { buttonVariants } from "../ui/button";
import { eyebrow, Section } from "./section";
import { StartButton } from "./start-button";

function PlanName({ page, children }: { page: boolean; children: string }) {
  const Tag = page ? "h2" : "h3";
  return <Tag className={`${eyebrow} text-ink-soft`}>{children}</Tag>;
}

export function Price({ source = null, page = false }: { source?: StartSource | null; page?: boolean }) {
  return (
    <Section
      id="price"
      page={page}
      kicker={page ? "Five to Nine pricing" : "Three plans"}
      title="Pick how closely you watch."
      lead="Every plan sends the Monday brief with the proof behind every line. Plans differ in how many competitors you follow, how deep we look, and how far back the proof goes."
    >
      <ul className="grid gap-4 md:grid-cols-3">
        {PLANS.map((plan) => (
          <li key={plan.id} className="min-w-0 border-[1.5px] border-line bg-card p-6">
            <PlanName page={page}>{plan.name}</PlanName>
            <p className="mt-3 font-display text-[2.4rem] leading-none font-extrabold tracking-[-0.03em]">
              €{String(plan.monthlyPriceEur)}
              <span className="ml-1 font-mono text-meta font-normal tracking-[0.06em] text-ink-soft">/month</span>
            </p>
            <ul className="mt-5 border-t border-line">
              {planIncludes(plan.id).map((line) => (
                <li key={line} className="border-b border-line py-2.5 text-body-sm">
                  {line}
                </li>
              ))}
            </ul>
            <a
              href={planStartHref(plan.id, source)}
              className={cn(buttonVariants({ variant: "secondary" }), "mt-5 w-full")}
            >
              Start with {plan.name}
            </a>
          </li>
        ))}
      </ul>
      <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
        <StartButton source={source} />
        <p className="max-w-[36rem] font-mono text-meta text-ink-soft">
          {TRIAL_TERMS} Change plan any time from Settings.
        </p>
      </div>
    </Section>
  );
}
