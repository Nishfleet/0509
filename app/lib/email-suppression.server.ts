import { env } from "cloudflare:workers";

export async function suppressToken(token: string, now = new Date()): Promise<"suppressed" | "missing"> {
  if (token.length === 0) return "missing";
  const target = await env.DB.prepare(`SELECT target_value FROM send_target WHERE unsubscribe_token = ?`)
    .bind(token)
    .first<{ target_value: string }>();
  if (!target) return "missing";
  await env.DB.prepare(
    `INSERT INTO email_suppression (address, reason, created_at) VALUES (lower(?), 'unsubscribe', ?)
     ON CONFLICT (address) DO NOTHING`,
  )
    .bind(target.target_value, now.toISOString())
    .run();
  return "suppressed";
}
