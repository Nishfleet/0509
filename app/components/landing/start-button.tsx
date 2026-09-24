import { monthlyPrice, PLANS } from "../../lib/billing/plans";

const [scout] = PLANS;

export const startButtonClass =
  "bg-ink text-bone border-ink font-display ease-push focus-visible:outline-green inline-flex min-h-12 items-center gap-3 border-[1.5px] px-6 py-3 text-[0.98rem] font-bold tracking-[-0.01em] transition-transform duration-140 hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2";

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
    <a href="/login" className={startButtonClass}>
      <StartWatchingLabel />
    </a>
  );
}
