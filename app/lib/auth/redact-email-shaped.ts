const EMAIL_SHAPED = /[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+/g;

export function redactEmailShaped(text: string): string {
  return text.replace(EMAIL_SHAPED, "[redacted]");
}
