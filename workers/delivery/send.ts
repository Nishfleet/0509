export interface SendResult {
  outcome: "sent" | "failed";
  error: string | null;
}

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

export async function sendOrThrow(
  email: SendEmail,
  message: EmailMessageBuilder,
): Promise<void> {
  const result = await sendMessage(email, message);
  if (result.outcome === "failed") {
    throw new Error(result.error ?? "send failed");
  }
}
