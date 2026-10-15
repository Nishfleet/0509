import { SUPPORT_ADDRESS } from "../../app/components/footer";

export interface SendResult {
  outcome: "sent" | "failed";
  error: string | null;
  subject?: string | null;
  provider_id?: string | null;
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

export async function sendMessage(email: SendEmail, message: EmailMessageBuilder): Promise<SendResult> {
  const subject = typeof message.subject === "string" ? message.subject : null;
  try {
    const sent = await email.send({ replyTo: SUPPORT_ADDRESS, ...message });
    return { outcome: "sent", error: null, subject, provider_id: sent?.messageId ?? null };
  } catch (end) {
    return { outcome: "failed", error: errorText(end), subject };
  }
}
