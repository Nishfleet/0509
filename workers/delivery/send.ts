/**
 * The one EMAIL.send call site in the repo.
 *
 * 0509#3979 / docs/engines/delivery.md § P7.2: "A second call site for
 * EMAIL.send anywhere in the repo — this file is the only one. ... Ship the
 * filter before the trigger, not after." Every outbound message the product
 * sends goes through sendMessage(), so the suppression check, the claim row and
 * the status vocabulary are written once instead of once per producer.
 *
 * The status vocabulary is fixed by P7.2 step 4: EMAIL.send resolving is the
 * strongest claim this code makes, because Cloudflare Email Service has no
 * delivery webhooks (docs/engines/delivery.md §3). "delivered" is never
 * recorded anywhere. A bounce is unobservable from here and the UI must not
 * imply arrival.
 *
 * The message and binding types are workerd's own (`EmailMessageBuilder`,
 * `SendEmail`, generated into worker-configuration.d.ts). Restating them here
 * made the binding stop satisfying the real `Env` — TypeScript caught it in
 * this packet's inner loop — so the runtime's declaration is the one used.
 */

export interface SendResult {
  outcome: "sent" | "failed";
  error: string | null;
}

/**
 * Error strings are persisted on send_attempt.error, so a provider's message
 * is truncated rather than dropped or allowed to grow without bound.
 */
const MAX_ERROR_CHARS = 2_000;

function errorText(end: unknown): string {
  if (end instanceof Error) {
    const cause = end.cause;
    const suffix = cause instanceof Error ? `: ${cause.message}` : "";
    return `${end.message}${suffix}`.slice(0, MAX_ERROR_CHARS);
  }
  return String(end).slice(0, MAX_ERROR_CHARS);
}

/** Exported so the consumer records the same truncated reason for a delivery
 *  that failed before the send (a malformed payload) as for one the provider
 *  rejected. One vocabulary for send_attempt.error. */
export { errorText };

/**
 * Sends one message and classifies the outcome. Never throws: the consumer
 * resolves send_attempt.status in every path, so "failed" is a row rather than
 * an exception that leaves a send unaccounted for.
 */
export async function sendMessage(
  email: SendEmail,
  message: EmailMessageBuilder,
): Promise<SendResult> {
  try {
    await email.send(message);
  } catch (end) {
    return { outcome: "failed", error: errorText(end) };
  }
  return { outcome: "sent", error: null };
}
