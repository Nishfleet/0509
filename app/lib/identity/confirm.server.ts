import { z } from "zod";

import { insertSelfEntity } from "../data/entity.server";
import { startDiscovery } from "../discovery/start.server";
import { readUrl } from "../fetch/transport.server";
import { extractIdentity } from "./extract";
import { normaliseSubject, type Subject } from "./normalise";
import { classifyNavPages } from "./page-role.server";
import { readLogo } from "./logo-store.server";

const SOCIAL_PREFIX = "social.";

const webUrl = z.url({ protocol: /^https?$/ });

const socialsSchema = z.array(z.object({ platform: z.string().min(1).max(40), url: webUrl })).max(20);

const confirmSchema = z.object({
  subject: z.string(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500),
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

async function classifyConfirmedSite(
  workspaceId: string,
  subject: Subject,
  entityId: string,
  now: Date,
): Promise<void> {
  if (subject.kind !== "domain" || subject.url === null) return;
  try {
    const page = await readUrl(subject.url);
    if (!page.ok) return;
    const extract = await extractIdentity(page.html, subject.url);
    await classifyNavPages(workspaceId, { id: entityId, domain: subject.registrable }, extract.navPages, now.toISOString());
  } catch (error) {
    console.log(
      JSON.stringify({ event: "identity-page-role-skipped", subject: subject.registrable, error: String(error) }),
    );
  }
}

export async function confirmCard(workspaceId: string, form: FormData): Promise<boolean> {
  const parsed = confirmSchema.safeParse({
    subject: field(form, "subject"),
    name: field(form, "name"),
    description: field(form, "description"),
    socials: socials(form),
  });
  if (!parsed.success) return false;
  const normalised = normaliseSubject(parsed.data.subject);
  if (!normalised.ok) return false;
  const { subject } = normalised;
  const card = parsed.data;
  const id = crypto.randomUUID();
  const logoUrl = (await readLogo(subject.registrable)) !== null ? `/app/logos/${id}` : null;
  const now = new Date();
  await insertSelfEntity({
    id,
    workspaceId,
    domain: subject.registrable,
    name: card.name,
    identityJson: JSON.stringify({
      kind: subject.kind,
      platform: subject.platform ?? null,
      url: subject.url,
      description: card.description === "" ? null : card.description,
      logoUrl,
      socials: card.socials,
    }),
    now: now.toISOString(),
  });
  await classifyConfirmedSite(workspaceId, subject, id, now);
  await startDiscovery(workspaceId, now);
  return true;
}
