import { monthlyPrice, PLANS } from "../../lib/billing/plans";
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

export function StartButton() {
  return (
    <a href="/login" className={buttonVariants({ variant: "primary", size: "lg" })}>
      <StartWatchingLabel />
    </a>
  );
}
