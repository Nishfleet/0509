const EMAIL_SHAPED = /[^\s@<>]+@[^\s@<>]+/g;
const HTTP_URL = /https?:\/\/\S+/g;

export function redactEmailShaped(text: string): string {
  return text.replace(HTTP_URL, "[redacted]").replace(EMAIL_SHAPED, "[redacted]");
}
