import { z } from "zod";

import { insertSelfEntity, readWorkspaceSelfId } from "../data/entity.server";
import { insertFieldEdits, type FieldEdit } from "../data/user_decision.server";
import { readUrl } from "../fetch/transport.server";
import { readCachedSiteValues, readSiteCard } from "./card.server";
import { extractIdentity } from "./extract";
import { readLogo } from "./logo-store.server";
import { normaliseSubject, type Subject } from "./normalise";
import { classifyNavPages } from "./page-role.server";
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

async function creatorSite(socials: { platform: string; url: string }[]): Promise<Subject | null> {
  const entry = socials.find((social) => social.platform === "site");
  if (entry === undefined) return null;
  const normalised = normaliseSubject(entry.url);
  if (!normalised.ok || normalised.subject.kind !== "domain") return null;
  await readSiteCard(normalised.subject);
  return normalised.subject;
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
    if (!page.ok) {
      console.log(
        JSON.stringify({ event: "identity-page-role-skipped", subject: subject.registrable, error: page.detail }),
      );
      return;
    }
    const extract = await extractIdentity(page.html, subject.url);
    await classifyNavPages(workspaceId, { id: entityId, domain: subject.registrable }, extract.navPages, now.toISOString());
  } catch (error) {
    console.log(
      JSON.stringify({ event: "identity-page-role-skipped", subject: subject.registrable, error: String(error) }),
    );
  }
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
  const entityId = await readWorkspaceSelfId(workspaceId);
  if (entityId === null) return false;
  const cached = await readCachedSiteValues(subject);
  if (cached !== null) {
    const candidates: { edit: FieldEdit; changed: boolean }[] = [
      {
        edit: { field: "name", from: cached.name, to: card.name },
        changed: card.name !== cached.name,
      },
      {
        edit: {
          field: "description",
          from: cached.description,
          to: card.description,
        },
        changed: (card.description === "" ? null : card.description) !== cached.description,
      },
    ];
    await insertFieldEdits(
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
  }
  await classifyConfirmedSite(workspaceId, subject, entityId, now);
  const site = subject.kind === "domain" ? null : await creatorSite(card.socials);
  await startIdentityTail({
    workspaceId,
    entityId,
    name: card.name,
    domain: site?.registrable ?? subject.registrable,
    homepageUrl: subject.kind === "domain" ? subject.url : (site?.url ?? null),
    ...(subject.kind === "domain" ? {} : { handle: subject.registrable }),
  });
  return true;
}
