export function briefText(payloadJson: string | null): string {
  if (payloadJson === null) return "";
  try {
    const parsed: unknown = JSON.parse(payloadJson);
    if (typeof parsed !== "object" || parsed === null || !("text" in parsed)) return "";
    const text = parsed.text;
    return typeof text === "string" ? text : "";
  } catch {
    return "";
  }
}

export function digestIdFromAlertId(alertId: string): string | null {
  return alertId.startsWith("dlq:") ? alertId.slice(4) : null;
}
