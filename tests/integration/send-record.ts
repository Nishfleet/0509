import { env } from "cloudflare:test";
import { expect } from "vitest";

export const PROVIDER_ID = "m-test";

export async function expectSendRecord(
  kind: string,
  subject: string | undefined,
  providerId = PROVIDER_ID,
): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT kind, subject, provider_message, status, error, workspace_id FROM send_attempt WHERE kind = ?`,
  )
    .bind(kind)
    .all();
  expect(results).toEqual([
    {
      kind,
      subject,
      provider_message: providerId,
      status: "sent",
      error: null,
      workspace_id: expect.any(String) as string,
    },
  ]);
}
