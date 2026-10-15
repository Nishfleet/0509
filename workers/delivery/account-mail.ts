import { redactEmailShaped } from "../../app/lib/auth/redact-email-shaped";
import { openAccountAttempt, resolveSendAttempt, type AccountMailKind } from "../../app/lib/data/send_attempt.server";

import { sendMessage, type SendResult } from "./send";

export interface AccountMailInput {
  kind: AccountMailKind;
  workspaceId: string | null;
  message: EmailMessageBuilder & { to: string };
}

export async function sendAccountMail(
  bindings: { DB: D1Database; EMAIL: SendEmail },
  input: AccountMailInput,
): Promise<SendResult> {
  const attempt = await openAccountAttempt(bindings.DB, {
    kind: input.kind,
    workspaceId: input.workspaceId,
  }).catch((cause: unknown) => {
    console.error(
      JSON.stringify({
        event: "delivery.send_record_unavailable",
        error: redactEmailShaped(cause instanceof Error ? cause.message : "record failed").slice(0, 300),
      }),
    );
    return null;
  });
  const result = await sendMessage(bindings.EMAIL, input.message);
  if (attempt !== null) {
    await resolveSendAttempt(bindings.DB, {
      attemptId: attempt.id,
      idempotencyKey: attempt.idempotencyKey,
      outcome: result.outcome,
      error: result.error === null ? null : redactEmailShaped(result.error),
      subject: result.subject ?? null,
      providerId: result.provider_id ?? null,
    }).catch((cause: unknown) => {
      console.error(
        JSON.stringify({
          event: "delivery.send_record_unreadable",
          error: redactEmailShaped(cause instanceof Error ? cause.message : "record failed").slice(0, 300),
        }),
      );
    });
  }
  return result;
}
