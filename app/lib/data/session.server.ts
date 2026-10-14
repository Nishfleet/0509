import { z } from "zod";

const SELECT_DEVICES = `SELECT id, updatedAt, userAgent FROM "session"
 WHERE userId = ?1 AND expiresAt > ?2 ORDER BY updatedAt DESC LIMIT 10`;

const deviceRow = z.object({
  id: z.string(),
  updatedAt: z.string(),
  userAgent: z.string().nullable(),
});

export type DeviceRow = z.infer<typeof deviceRow>;

export async function readDevices(db: D1Database, userId: string, now: Date): Promise<DeviceRow[]> {
  const { results } = await db.prepare(SELECT_DEVICES).bind(userId, now.toISOString()).all();
  return deviceRow.array().parse(results);
}
