import { z } from "zod";

const SOCIAL_PREFIX = "social.";

const webUrl = z.url({ protocol: /^https?$/ });

const socialsSchema = z.array(z.object({ platform: z.string().min(1).max(40), url: webUrl })).max(20);

export const confirmSchema = z.object({
  subject: z.string(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500),
  socials: socialsSchema,
});

export interface ConfirmFields {
  subject: string;
  name: string;
  description: string;
  socials: { platform: string; url: unknown }[];
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function socials(form: FormData): { platform: string; url: unknown }[] {
  return [...form.entries()]
    .filter(([key]) => key.startsWith(SOCIAL_PREFIX))
    .map(([key, url]) => ({ platform: key.slice(SOCIAL_PREFIX.length), url }));
}

export function readConfirmFields(form: FormData): ConfirmFields {
  return {
    subject: field(form, "subject"),
    name: field(form, "name"),
    description: field(form, "description"),
    socials: socials(form),
  };
}
