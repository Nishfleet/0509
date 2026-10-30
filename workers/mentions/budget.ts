import type { TargetOutcome } from "./sweep";

const MINUTE_MS = 60_000;

export const RUN_BUDGET_MS = 45 * MINUTE_MS;
export const FAILED_TARGET_MS = MINUTE_MS;

interface DeferredSource {
  source: string;
  targets: number;
}

export async function timed(work: () => Promise<TargetOutcome>): Promise<TargetOutcome> {
  const started = Date.now();
  const outcome = await work();
  return { ...outcome, ms: Date.now() - started };
}

export class SweepBudget {
  private total = 0;
  private readonly cut = new Map<string, number>();

  spend(ms: number): void {
    this.total += ms;
  }

  spent(): boolean {
    return this.total >= RUN_BUDGET_MS;
  }

  defer(pluginKey: string): void {
    this.cut.set(pluginKey, (this.cut.get(pluginKey) ?? 0) + 1);
  }

  deferred(): DeferredSource[] {
    return [...this.cut].map(([source, targets]) => ({ source, targets }));
  }
}

export function bySourceRoundRobin<T extends { pluginKey: string }>(targets: readonly T[]): T[] {
  const queues = new Map<string, T[]>();
  for (const target of targets) {
    const queue = queues.get(target.pluginKey) ?? [];
    queue.push(target);
    queues.set(target.pluginKey, queue);
  }
  const longest = Math.max(0, ...[...queues.values()].map((queue) => queue.length));
  const order: T[] = [];
  for (let turn = 0; turn < longest; turn += 1) {
    for (const queue of queues.values()) {
      const target = queue[turn];
      if (target !== undefined) order.push(target);
    }
  }
  return order;
}
