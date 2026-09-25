import { DurableObject } from "cloudflare:workers";

const COUNT_KEY = "count";
const EXPIRE_MS = 2 * 24 * 60 * 60 * 1000;

export class BrowserBudget extends DurableObject {
  async take(limit: number): Promise<boolean> {
    const used = (await this.ctx.storage.get<number>(COUNT_KEY)) ?? 0;
    if (used >= limit) return false;
    await this.ctx.storage.put(COUNT_KEY, used + 1);
    if (used === 0) await this.ctx.storage.setAlarm(Date.now() + EXPIRE_MS);
    return true;
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
