// The workspace delivery timezone is stored as free text, so formatters must
// not trust it blindly: an invalid IANA name makes Intl.DateTimeFormat throw,
// which would fail digest sends and page renders. Fall back to UTC instead —
// the product's global-first default.
export function normalizeTimeZone(timeZone: string | null | undefined): string | null {
  const candidate = timeZone?.trim();
  if (!candidate) return null;

  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: candidate });
    return candidate;
  } catch {
    return null;
  }
}

export function safeTimeZone(timeZone: string | null | undefined): string {
  return normalizeTimeZone(timeZone) ?? "UTC";
}
