type Step = "approve" | "confirm";

const FLAG: Record<Step, string> = { approve: "approved", confirm: "changed" };

const APPROVED = "Approved. We sent a confirmation link to the new address. Nothing changes until you open it.";

export function withEmailLanding(link: string, step: Step): string {
  const url = new URL(link);
  url.searchParams.set("callbackURL", `/app/settings?email=${FLAG[step]}`);
  return url.toString();
}

export function emailLandingLine(params: URLSearchParams, signInEmail: string): string | null {
  if (params.has("error")) return null;
  const flag = params.get("email");
  if (flag === "approved") return APPROVED;
  return flag === "changed" ? `Done. You sign in with ${signInEmail} now.` : null;
}
