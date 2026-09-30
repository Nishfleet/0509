import { z } from "zod";

import { insertSelfEntity, readWorkspaceSelfId } from "../data/entity.server";
import { insertFieldEdits, type FieldEdit } from "../data/user_decision.server";
import { readCachedSiteValues } from "./card.server";
import { readLogo } from "./logo-store.server";
import { normaliseSubject, type Subject } from "./normalise";
import { startIdentityTail } from "./tail.server";

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

function creatorSite(socials: { platform: string; url: string }[]): Subject | null {
  const entry = socials.find((social) => social.platform === "site");
  if (entry === undefined) return null;
  const normalised = normaliseSubject(entry.url);
  if (!normalised.ok || normalised.subject.kind !== "domain") return null;
  return normalised.subject;
}

export async function confirmCard(workspaceId: string, userId: string, form: FormData): Promise<boolean> {
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
  const [logo, cached] = await Promise.all([readLogo(subject.registrable), readCachedSiteValues(subject)]);
  const logoUrl = logo !== null ? `/app/logos/${id}` : null;
  const now = new Date();
  const inserted = await insertSelfEntity({
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
  const entityId = inserted ? id : await readWorkspaceSelfId(workspaceId);
  if (entityId === null) return false;
  const candidates: { edit: FieldEdit; changed: boolean }[] =
    !inserted || cached === null
      ? []
      : [
          {
            edit: { field: "name", from: cached.name, to: card.name },
            changed: card.name !== cached.name,
          },
          {
            edit: { field: "description", from: cached.description, to: card.description },
            changed: (card.description === "" ? null : card.description) !== cached.description,
          },
        ];
  const edits = insertFieldEdits(
    candidates
      .filter((candidate) => candidate.changed)
      .map((candidate) => ({
        workspaceId,
        userId,
        entityId,
        edit: candidate.edit,
        decidedAt: now.toISOString(),
      })),
  );
  const site = subject.kind === "domain" ? null : creatorSite(card.socials);
  const tail = startIdentityTail({
    workspaceId,
    entityId,
    name: card.name,
    domain: site?.registrable ?? subject.registrable,
    homepageUrl: subject.kind === "domain" ? subject.url : (site?.url ?? null),
    ...(subject.kind === "domain" ? {} : { handle: subject.registrable }),
  });
  await Promise.all([edits, tail]);
  return true;
}
