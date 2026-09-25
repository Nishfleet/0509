import { redirect } from "react-router";
import { z } from "zod";

import { readSelfCard } from "../data/entity.server";
import { isTakenDown } from "../data/takedown.server";
import { readWorkspaceIdForOwner } from "../data/workspace.server";
import { screenOnboardingSubject } from "../onboarding-screen.server";
import { readDraft } from "./card-draft.server";
import type { CardDraft, SiteFields } from "./card-fields";
import { startCard, withinProbeLimit } from "./card.server";
import { readLogo } from "./logo-store.server";
import { normaliseSubject } from "./normalise";

export interface IdentityScreenCard {
  subject: string;
  domain: string;
  site: Promise<SiteFields>;
  logo: Promise<string | null>;
  draft: CardDraft;
}

export interface IdentityScreen {
  card: IdentityScreenCard | null;
  limited: boolean;
}

const identitySchema = z.object({
  kind: z.enum(["domain", "handle", "channel"]).optional(),
  url: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  socials: z.array(z.object({ platform: z.string(), url: z.string() })).optional(),
});

type IdentityJson = z.infer<typeof identitySchema>;

function parseIdentity(raw: string): IdentityJson {
  try {
    const parsed = identitySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch (error) {
    console.log(JSON.stringify({ event: "identity-card-unreadable", error: String(error) }));
    return {};
  }
}

function shownDomain(domain: string, identity: IdentityJson): string {
  if (identity.kind === "handle" || identity.kind === "channel") return identity.url ?? `@${domain}`;
  return domain;
}

function formSubject(domain: string, identity: IdentityJson): string {
  if (typeof identity.url === "string" && identity.url !== "") return identity.url;
  if (identity.kind === "handle" || identity.kind === "channel") return `@${domain}`;
  return domain;
}

function toDataUrl(contentType: string, bytes: Uint8Array): string {
  const base64 = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
  return `data:${contentType};base64,${base64}`;
}

async function savedLogo(domain: string): Promise<string | null> {
  try {
    const kept = await readLogo(domain);
    if (kept === null) return null;
    const contentType = kept.httpMetadata?.contentType ?? "image/png";
    const bytes = new Uint8Array(await kept.arrayBuffer());
    return toDataUrl(contentType, bytes);
  } catch (error) {
    console.log(JSON.stringify({ event: "identity-logo-failed", subject: domain, error: String(error) }));
    return null;
  }
}

async function savedCard(workspaceId: string): Promise<IdentityScreenCard | null> {
  const row = await readSelfCard(workspaceId);
  if (row === null) return null;
  const identity = parseIdentity(row.identityJson);
  const socials = identity.socials ?? [];
  const description = identity.description ?? null;
  const site: SiteFields = {
    name: row.name,
    description,
    socials,
    review: {
      name: row.name ? "fill" : "empty",
      description: description ? "fill" : "empty",
      socials: socials.length > 0 ? "fill" : "empty",
    },
    unfound: false,
  };
  return {
    subject: formSubject(row.domain, identity),
    domain: shownDomain(row.domain, identity),
    site: Promise.resolve(site),
    logo: savedLogo(row.domain),
    draft: await readDraft(workspaceId, row.domain),
  };
}

export async function loadIdentityScreen(request: Request, userId: string): Promise<IdentityScreen> {
  const workspaceId = await readWorkspaceIdForOwner(userId);
  if (workspaceId === null) throw redirect("/onboarding");

  const saved = await savedCard(workspaceId);
  if (saved) return { card: saved, limited: false };

  const raw = new URL(request.url).searchParams.get("subject") ?? "";
  const normalised = normaliseSubject(raw);
  if (!normalised.ok) return { card: null, limited: false };
  const { subject } = normalised;
  if (await isTakenDown(subject.registrable)) throw redirect("/onboarding");
  const screened = await screenOnboardingSubject({
    workspaceId,
    userId,
    subject,
    raw,
    answer: null,
    now: new Date().toISOString(),
  });
  if (screened.kind !== "proceed") throw redirect("/onboarding");
  if (!(await withinProbeLimit(userId))) return { card: null, limited: true };
  const shown = subject.kind === "domain" ? subject.registrable : (subject.url ?? `@${subject.registrable}`);
  return {
    card: {
      subject: raw,
      domain: shown,
      ...startCard(workspaceId, subject),
      draft: await readDraft(workspaceId, subject.registrable),
    },
    limited: false,
  };
}
