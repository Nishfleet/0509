type Step = "approve" | "confirm";

const FLAG: Record<Step, string> = { approve: "approved", confirm: "changed" };

const LINES: Record<string, string> = {
  approved: "Approved. We sent a confirmation link to the new address. Nothing changes until you open it.",
  changed: "Done. This is the email you sign in with now.",
};

export function withEmailLanding(link: string, step: Step): string {
  const url = new URL(link);
  url.searchParams.set("callbackURL", `/app/settings?email=${FLAG[step]}`);
  return url.toString();
}

export function emailLandingLine(flag: string | null): string | null {
  return flag === null ? null : (LINES[flag] ?? null);
}
