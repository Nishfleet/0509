import { z } from "zod";

import { insertSelfEntity } from "../data/entity.server";
import { normaliseSubject } from "./normalise";

const SOCIAL_PREFIX = "social.";

const webUrl = z.url({ protocol: /^https?$/ });

const socialsSchema = z.array(z.object({ platform: z.string().min(1).max(40), url: webUrl })).max(20);

const confirmSchema = z.object({
  subject: z.string(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500),
  logo: z.union([webUrl, z.literal("")]),
  socials: socialsSchema,
});

function socials(form: FormData): { platform: string; url: unknown }[] {
  return [...form.entries()]
    .filter(([key]) => key.startsWith(SOCIAL_PREFIX))
    .map(([key, url]) => ({ platform: key.slice(SOCIAL_PREFIX.length), url }));
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export async function confirmCard(workspaceId: string, form: FormData): Promise<boolean> {
  const parsed = confirmSchema.safeParse({
    subject: field(form, "subject"),
    name: field(form, "name"),
    description: field(form, "description"),
    logo: field(form, "logo"),
    socials: socials(form),
  });
  if (!parsed.success) return false;
  const normalised = normaliseSubject(parsed.data.subject);
  if (!normalised.ok) return false;
  const { subject } = normalised;
  const card = parsed.data;
  await insertSelfEntity({
    id: crypto.randomUUID(),
    workspaceId,
    domain: subject.registrable,
    name: card.name,
    identityJson: JSON.stringify({
      kind: subject.kind,
      platform: subject.platform ?? null,
      url: subject.url,
      description: card.description === "" ? null : card.description,
      logoUrl: card.logo === "" ? null : card.logo,
      socials: card.socials,
    }),
    now: new Date().toISOString(),
  });
  return true;
}
