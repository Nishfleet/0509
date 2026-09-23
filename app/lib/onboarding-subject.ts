export function subjectRedirect(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== "string") return null;
  const subject = raw.trim();
  if (subject === "") return null;
  return `/onboarding/identity?subject=${encodeURIComponent(subject)}`;
}
