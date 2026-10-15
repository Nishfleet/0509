import { SUPPORT_ADDRESS } from "../../app/components/footer";
import { suppressBouncedAddress } from "../../app/lib/data/email_suppression.server";

export interface SendResult {
  outcome: "sent" | "failed";
  error: string | null;
}

export const BRIEF_SENDER = { email: "brief@0509.io", name: "Five to Nine" };

const MAX_ERROR_CHARS = 2_000;

function errorText(end: unknown): string {
  if (end instanceof Error) {
    const cause = end.cause;
    const suffix = cause instanceof Error ? `: ${cause.message}` : "";
    return `${end.message}${suffix}`.slice(0, MAX_ERROR_CHARS);
  }
  return String(end).slice(0, MAX_ERROR_CHARS);
}

export { errorText };

const RECIPIENT_SUPPRESSED = "E_RECIPIENT_SUPPRESSED";

function recipientAddresses(to: EmailMessageBuilder["to"]): string[] {
  const list = Array.isArray(to) ? to : [to];
  return list.flatMap((one) => (one === undefined ? [] : [typeof one === "string" ? one : one.email]));
}

export async function sendMessage(email: SendEmail, message: EmailMessageBuilder): Promise<SendResult> {
  try {
    await email.send({ replyTo: SUPPORT_ADDRESS, ...message });
  } catch (end) {
    if (end instanceof Error && "code" in end && end.code === RECIPIENT_SUPPRESSED) {
      const [only, ...others] = recipientAddresses(message.to);
      if (only !== undefined && others.length === 0) {
        await suppressBouncedAddress(only).catch((failure: unknown) => {
          console.error({ event: "send.suppression_record_failed", error: errorText(failure) });
        });
      }
    }
    return { outcome: "failed", error: errorText(end) };
  }
  return { outcome: "sent", error: null };
}

export async function sendOrThrow(email: SendEmail, message: EmailMessageBuilder): Promise<void> {
  const result = await sendMessage(email, message);
  if (result.outcome === "failed") {
    throw new Error(result.error ?? "send failed");
  }
}
