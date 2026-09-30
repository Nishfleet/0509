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
  const startTail = await confirmCardLater(workspaceId, userId, form);
  if (startTail === null) return false;
  await startTail();
  return true;
}

type ConfirmedCard = z.infer<typeof confirmSchema>;
type CachedValues = Awaited<ReturnType<typeof readCachedSiteValues>>;

function parseConfirm(form: FormData): { card: ConfirmedCard; subject: Subject } | null {
  const parsed = confirmSchema.safeParse({
    subject: field(form, "subject"),
    name: field(form, "name"),
    description: field(form, "description"),
    socials: socials(form),
  });
  if (!parsed.success) return null;
  const normalised = normaliseSubject(parsed.data.subject);
  if (!normalised.ok) return null;
  return { card: parsed.data, subject: normalised.subject };
}

function identityJson(subject: Subject, card: ConfirmedCard, logoUrl: string | null): string {
  return JSON.stringify({
    kind: subject.kind,
    platform: subject.platform ?? null,
    url: subject.url,
    description: card.description === "" ? null : card.description,
    logoUrl,
    socials: card.socials,
  });
}

function changedEdits(card: ConfirmedCard, cached: CachedValues): FieldEdit[] {
  if (cached === null) return [];
  const candidates: { edit: FieldEdit; changed: boolean }[] = [
    {
      edit: { field: "name", from: cached.name, to: card.name },
      changed: card.name !== cached.name,
    },
    {
      edit: { field: "description", from: cached.description, to: card.description },
      changed: (card.description === "" ? null : card.description) !== cached.description,
    },
  ];
  return candidates.filter((candidate) => candidate.changed).map((candidate) => candidate.edit);
}

function tailParamsFor(
  base: { workspaceId: string; entityId: string },
  subject: Subject,
  card: ConfirmedCard,
): Parameters<typeof startIdentityTail>[0] {
  const site = subject.kind === "domain" ? null : creatorSite(card.socials);
  return {
    ...base,
    name: card.name,
    domain: site?.registrable ?? subject.registrable,
    homepageUrl: subject.kind === "domain" ? subject.url : (site?.url ?? null),
    ...(subject.kind === "domain" ? {} : { handle: subject.registrable }),
  };
}

export async function confirmCardLater(
  workspaceId: string,
  userId: string,
  form: FormData,
): Promise<(() => Promise<string>) | null> {
  const confirmed = parseConfirm(form);
  if (confirmed === null) return null;
  const { card, subject } = confirmed;
  const id = crypto.randomUUID();
  const [logo, cached] = await Promise.all([readLogo(subject.registrable), readCachedSiteValues(subject)]);
  const now = new Date().toISOString();
  const inserted = await insertSelfEntity({
    id,
    workspaceId,
    domain: subject.registrable,
    name: card.name,
    identityJson: identityJson(subject, card, logo !== null ? `/app/logos/${id}` : null),
    now,
  });
  const entityId = inserted ? id : await readWorkspaceSelfId(workspaceId);
  if (entityId === null) return null;
  const edits = insertFieldEdits(
    (inserted ? changedEdits(card, cached) : []).map((edit) => ({
      workspaceId,
      userId,
      entityId,
      edit,
      decidedAt: now,
    })),
  );
  const tailParams = tailParamsFor({ workspaceId, entityId }, subject, card);
  await edits;
  return () => startIdentityTail(tailParams);
}
