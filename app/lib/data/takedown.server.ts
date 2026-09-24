import { env } from "cloudflare:workers";

const SELECT_TAKEDOWN = "SELECT 1 AS hit FROM takedown WHERE subject = ?";

export async function isTakenDown(subject: string): Promise<boolean> {
  const row = await env.DB.prepare(SELECT_TAKEDOWN).bind(subject).first<{ hit: number }>();
  return row !== null;
}
