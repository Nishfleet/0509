import { type PlanId, PLANS, TRIAL_TERMS } from "../../lib/billing/plans";
import { cn } from "../../lib/utils";
import { eyebrow, Section } from "./section";
import { StartButton } from "./start-button";

const INCLUDES: Record<PlanId, readonly string[]> = {
  scout: [
    "5 competitors watched at once",
    "Homepage and pricing page changes",
    "90 days of before-and-afters",
    "4 weeks of standing history",
    "Read-only API and MCP",
  ],
  starter: [
    "15 competitors watched at once",
    "Every page we find, checked for changes",
    "Alerts the moment your own site breaks",
    "Google Search results and LinkedIn ads",
    "A year of before-and-afters and standing",
  ],
  agency: [
    "50 competitors per workspace",
    "Every page, checked for changes",
    "As many workspaces as you set up",
    "Everything in Starter",
  ],
};

export function Price() {
  return (
    <Section
      id="price"
      kicker="Three plans"
      title="Pick how closely you watch."
      lead="Every plan sends the Monday brief with the proof behind every line. Plans differ in how many rivals you follow, how deep we look, and how far back the proof goes."
    >
      <ul className="grid gap-4 md:grid-cols-3">
        {PLANS.map((plan) => (
          <li
            key={plan.id}
            className={cn("min-w-0 border-[1.5px] p-6", plan.id === "starter" ? "border-ink bg-card" : "border-line bg-card")}
          >
            <h3 className={`${eyebrow} text-ink-soft`}>{plan.name}</h3>
            <p className="font-display mt-3 text-[2.4rem] leading-none font-extrabold tracking-[-0.03em]">
              €{String(plan.monthlyPriceEur)}
              <span className="font-mono text-meta text-ink-soft ml-1 font-normal tracking-[0.06em]">/month</span>
            </p>
            <ul className="border-line mt-5 border-t">
              {INCLUDES[plan.id].map((line) => (
                <li key={line} className="border-line border-b py-2.5 text-body-sm">
                  {line}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
        <StartButton />
        <p className="font-mono text-meta text-ink-soft max-w-[36rem]">
          {TRIAL_TERMS} Change plan any time from Settings.
        </p>
      </div>
    </Section>
  );
}
