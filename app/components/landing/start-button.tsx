import { monthlyPrice, PLANS } from "../../lib/billing/plans";
import type { StartSource } from "../../lib/pricing-page";
import { buttonVariants } from "../ui/button";

const [scout] = PLANS;

export function StartWatchingLabel() {
  return (
    <>
      Start watching
      <span className="font-mono text-[0.78rem] font-medium tracking-[0.04em] opacity-80">
        {monthlyPrice(scout.monthlyPriceEur)}
      </span>
    </>
  );
}

export function StartButton({ source = null }: { source?: StartSource | null }) {
  return (
    <a href={source === null ? "/login" : `/login?utm_source=${source}`} className={buttonVariants({ variant: "primary", size: "lg" })}>
      <StartWatchingLabel />
    </a>
  );
}
