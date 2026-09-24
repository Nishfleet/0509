import { type PlanId, PLANS, TRIAL_TERMS } from "../../lib/billing/plans";
import { type CoverageId, isLive } from "../../lib/coverage";
import { cn } from "../../lib/utils";
import { eyebrow, Section } from "./section";
import { StartButton } from "./start-button";

const INCLUDES: Record<PlanId, readonly (string | { line: string; needs: CoverageId })[]> = {
  scout: [
    "5 competitors watched at once",
    { line: "Homepage changes", needs: "site.home" },
    { line: "Pricing page changes", needs: "site.pricing" },
    "90 days of before-and-afters",
    "4 weeks of standing history",
    "Read-only API and MCP",
  ],
  starter: [
    "15 competitors watched at once",
    { line: "Every page we find, checked for changes", needs: "site.all" },
    { line: "Alerts the moment your own site breaks", needs: "own.breakage" },
    { line: "Google Search results and LinkedIn ads", needs: "ads.linkedin" },
    "A year of before-and-afters and standing",
  ],
  agency: [
    "50 competitors per workspace",
    { line: "Every page, checked for changes", needs: "site.all" },
    "As many workspaces as you set up",
    "Everything in Starter",
  ],
};

function includes(plan: PlanId): string[] {
  return INCLUDES[plan].flatMap((entry) =>
    typeof entry === "string" ? [entry] : isLive(entry.needs) ? [entry.line] : [],
  );
}

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
              {includes(plan.id).map((line) => (
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
