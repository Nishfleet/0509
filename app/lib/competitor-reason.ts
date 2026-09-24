export const COMPETITOR_REASON_LINES: Readonly<Record<string, string>> = {
  active: "We're not sure it still competes with you",
  acquired: "Looks like it was acquired",
  shut_down: "Looks like it shut down",
  pivoted: "Looks like it changed what it sells",
  dormant: "Quiet for the last 30 days",
};

export function competitorReasonLine(reason: string): string | undefined {
  return Object.hasOwn(COMPETITOR_REASON_LINES, reason)
    ? COMPETITOR_REASON_LINES[reason]
    : undefined;
}

export function competitorReasonFragment(reason: string): string | undefined {
  const line = competitorReasonLine(reason);
  return line === undefined ? undefined : line.charAt(0).toLowerCase() + line.slice(1);
}
