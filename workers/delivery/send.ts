import { SUPPORT_ADDRESS } from "../../app/components/footer";

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

export async function sendMessage(email: SendEmail, message: EmailMessageBuilder): Promise<SendResult> {
  try {
    await email.send({ replyTo: SUPPORT_ADDRESS, ...message });
  } catch (end) {
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
