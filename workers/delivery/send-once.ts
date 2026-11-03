import type { RenderedBrief } from "../../app/lib/brief-payload";
import { redactEmailShaped } from "../../app/lib/auth/redact-email-shaped";
import { claimSendAttempt, resolveSendAttempt } from "../../app/lib/data/send_attempt.server";

import { reportLifecycleFailure } from "./lifecycle-failure";
import { BRIEF_SENDER, sendMessage } from "./send";

export interface SendOnceInput {
  key: string;
  workspaceId: string;
  targetId: string;
  to: string;
  render: () => RenderedBrief;
  headers?: Record<string, string>;
}

export async function sendOnce(env: Env, input: SendOnceInput): Promise<boolean> {
  const claim = await claimSendAttempt(env.DB, {
    idempotencyKey: input.key,
    workspaceId: input.workspaceId,
    targetId: input.targetId,
    digestId: null,
  });
  if (claim === null) return false;
  const result = await Promise.resolve()
    .then(() => {
      const rendered = input.render();
      return sendMessage(env.EMAIL, {
        to: input.to,
        from: BRIEF_SENDER,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        ...(input.headers === undefined ? {} : { headers: input.headers }),
      });
    })
    .catch((error: unknown) => ({
      outcome: "failed" as const,
      error: redactEmailShaped(error instanceof Error ? error.message : "render failed"),
    }));
  await resolveSendAttempt(env.DB, {
    attemptId: claim.id,
    idempotencyKey: input.key,
    outcome: result.outcome,
    error: result.error,
    subject: "subject" in result ? result.subject : null,
    providerId: "provider_id" in result ? result.provider_id : null,
  });
  if (result.outcome === "failed") reportLifecycleFailure("delivery.lifecycle_send_failed", result.error);
  return result.outcome === "sent";
}
