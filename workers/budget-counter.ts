import { DurableObject } from "cloudflare:workers";

const COUNT_KEY = "count";
const RESERVATION_PREFIX = "reservation:";
const MS_KEY = "ms";
const EXPIRE_MS = 2 * 24 * 60 * 60 * 1000;

export class BrowserBudget extends DurableObject {
  async take(limit: number, amount = 1): Promise<boolean> {
    const used = (await this.ctx.storage.get<number>(COUNT_KEY)) ?? 0;
    if (used + amount > limit) return false;
    await this.ctx.storage.put(COUNT_KEY, used + amount);
    if (used === 0) await this.ctx.storage.setAlarm(Date.now() + EXPIRE_MS);
    return true;
  }

  async reserve(limit: number, amount: number): Promise<string | null> {
    if (!(await this.take(limit, amount))) return null;
    const id = crypto.randomUUID();
    await this.ctx.storage.put(`${RESERVATION_PREFIX}${id}`, amount);
    return id;
  }

  async refund(id: string, amount: number): Promise<void> {
    if (amount <= 0) return;
    const key = `${RESERVATION_PREFIX}${id}`;
    const held = (await this.ctx.storage.get<number>(key)) ?? 0;
    const released = Math.min(amount, held);
    if (released <= 0) return;
    const used = (await this.ctx.storage.get<number>(COUNT_KEY)) ?? 0;
    await this.ctx.storage.put(COUNT_KEY, Math.max(0, used - released));
    if (held === released) await this.ctx.storage.delete(key);
    else await this.ctx.storage.put(key, held - released);
  }

  async addMs(ms: number): Promise<void> {
    const total = (await this.ctx.storage.get<number>(MS_KEY)) ?? 0;
    await this.ctx.storage.put(MS_KEY, total + ms);
    if (total === 0) await this.ctx.storage.setAlarm(Date.now() + EXPIRE_MS);
  }

  async totalMs(): Promise<number> {
    return (await this.ctx.storage.get<number>(MS_KEY)) ?? 0;
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
