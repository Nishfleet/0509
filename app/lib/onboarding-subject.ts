export const ONBOARDING_IDENTITY_PATH = "/onboarding/identity";

export function subjectRedirect(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== "string") return null;
  const subject = raw.trim();
  if (subject === "") return null;
  return `${ONBOARDING_IDENTITY_PATH}?subject=${encodeURIComponent(subject)}`;
}
