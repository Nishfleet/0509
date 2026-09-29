export function redactEmailShaped(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, "[redacted]")
    .replace(/bearer\s+\S+/gi, "[redacted]")
    .replace(/[^\s@<>]+@[^\s@<>]+/g, "[redacted]");
}
