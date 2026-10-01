import { DurableObject } from "cloudflare:workers";

const COUNT_KEY = "count";
const MS_KEY = "ms";
const EXPIRE_MS = 2 * 24 * 60 * 60 * 1000;

export class BrowserBudget extends DurableObject {
  async take(limit: number): Promise<boolean> {
    const used = (await this.ctx.storage.get<number>(COUNT_KEY)) ?? 0;
    if (used >= limit) return false;
    await this.ctx.storage.put(COUNT_KEY, used + 1);
    if (used === 0) await this.ctx.storage.setAlarm(Date.now() + EXPIRE_MS);
    return true;
  }

  async addMs(ms: number, engine: "kitesurf" | "chromium"): Promise<void> {
    const total = (await this.ctx.storage.get<number>(MS_KEY)) ?? 0;
    const engineKey = `${MS_KEY}:${engine}`;
    const byEngine = (await this.ctx.storage.get<number>(engineKey)) ?? 0;
    await this.ctx.storage.put({ [MS_KEY]: total + ms, [engineKey]: byEngine + ms });
    if (total === 0) await this.ctx.storage.setAlarm(Date.now() + EXPIRE_MS);
  }

  async totalMs(): Promise<number> {
    return (await this.ctx.storage.get<number>(MS_KEY)) ?? 0;
  }

  async engineMs(engine: "kitesurf" | "chromium"): Promise<number> {
    return (await this.ctx.storage.get<number>(`${MS_KEY}:${engine}`)) ?? 0;
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
