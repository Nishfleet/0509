import { normaliseSubject, type Subject } from "./normalise";

export function creatorSite(socials: { platform: string; url: string }[]): Subject | null {
  const entry = socials.find((social) => social.platform === "site");
  if (entry === undefined) return null;
  const normalised = normaliseSubject(entry.url);
  if (!normalised.ok || normalised.subject.kind !== "domain") return null;
  return normalised.subject;
}
