// The workspace delivery timezone is stored as free text, so formatters must
// not trust it blindly: an invalid IANA name makes Intl.DateTimeFormat throw,
// which would fail digest sends and page renders. Fall back to UTC instead —
// the product's global-first default.
export function safeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone?.trim()) {
    return "UTC";
  }

  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}
