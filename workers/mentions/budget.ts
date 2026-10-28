import type { TargetOutcome } from "./sweep";

const MINUTE_MS = 60_000;

export const RUN_BUDGET_MS = 45 * MINUTE_MS;
export const SOURCE_BUDGET_MS = 15 * MINUTE_MS;
export const FAILED_TARGET_MS = MINUTE_MS;

type BudgetReason = "run_budget" | "source_budget";

interface DeferredSource {
  source: string;
  reason: BudgetReason;
  targets: number;
}

export async function timed(work: () => Promise<TargetOutcome>): Promise<TargetOutcome> {
  const started = Date.now();
  const outcome = await work();
  return { ...outcome, ms: Date.now() - started };
}

export class SweepBudget {
  private total = 0;
  private readonly bySource = new Map<string, number>();
  private readonly cut = new Map<string, DeferredSource>();

  spend(pluginKey: string | null, ms: number): void {
    this.total += ms;
    if (pluginKey !== null) this.bySource.set(pluginKey, (this.bySource.get(pluginKey) ?? 0) + ms);
  }

  reason(pluginKey: string): BudgetReason | null {
    if (this.total >= RUN_BUDGET_MS) return "run_budget";
    return (this.bySource.get(pluginKey) ?? 0) >= SOURCE_BUDGET_MS ? "source_budget" : null;
  }

  defer(pluginKey: string, reason: BudgetReason): void {
    const key = `${pluginKey}\u0000${reason}`;
    const entry = this.cut.get(key) ?? { source: pluginKey, reason, targets: 0 };
    this.cut.set(key, { ...entry, targets: entry.targets + 1 });
  }

  deferred(): DeferredSource[] {
    return [...this.cut.values()];
  }
}
