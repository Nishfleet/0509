import { env } from "cloudflare:workers";
import { z } from "zod";

import { readUrl, probeFailureReason, ReadUrlError } from "../fetch/transport.server";
import type { ReadUrlFailureReason, ReadUrlOptions } from "../fetch/transport.server";
import { sha256Hex } from "../sha256";
import { takeBrowserEscalation } from "../site/browser-budget.server";
import type { CardReview, CardValues, DraftField, SiteFields } from "./card-fields";
import { extractIdentity } from "./extract";
import { reviewFields } from "./field-confidence.server";
import { readLogo, storeLogo } from "./logo-store.server";
import { logoCandidateUrls } from "./logo-cascade";
import type { LogoCandidates } from "./logo-cascade";
import { resolveBrandName } from "./name-cascade.server";
import { normaliseSubject } from "./normalise";
import type { Subject } from "./normalise";
import { cachedProbe, probeKey } from "./probe-cache.server";

const socialSchema = z.object({ platform: z.string(), url: z.string() });

const siteCardSchema = z.object({
  name: z.string().nullable(),
  description: z.string().nullable(),
  socials: z.array(socialSchema),
  logoCandidates: z.object({
    ldOrganizationLogo: z.string().nullable(),
    ogImage: z.string().nullable(),
    appleTouchIcon: z.string().nullable(),
  }),
  adLibraryHints: z.array(z.string()).default([]),
  navLinks: z.array(z.string()).default([]),
});

type SiteCard = z.infer<typeof siteCardSchema>;

function hasIdentity(card: SiteCard): boolean {
  return card.name !== null || card.description !== null || card.socials.length > 0;
}

const readSiteCardSchema = siteCardSchema.refine(hasIdentity);

const ICON_PROBE_V = 2;

const logoSchema = z.object({ v: z.literal(ICON_PROBE_V), url: z.string().nullable() });

const UNREACHED: SiteCard = {
  name: null,
  description: null,
  socials: [],
  logoCandidates: { ldOrganizationLogo: null, ogImage: null, appleTouchIcon: null },
  adLibraryHints: [],
  navLinks: [],
};

class BudgetDeferredError extends ReadUrlError {
  constructor() {
    super("deferred");
    this.name = "BudgetDeferredError";
  }
}

function readFailure(page: { reason: ReadUrlFailureReason }): Error {
  return page.reason === "deferred" ? new BudgetDeferredError() : new ReadUrlError(page.reason);
}

function unreachedEvent(scope: "site" | "creator", error: unknown): string {
  return error instanceof BudgetDeferredError ? `identity-${scope}-deferred` : `identity-${scope}-unreached`;
}

type MayEscalate = NonNullable<ReadUrlOptions["mayEscalate"]>;

export function brandBudget(workspaceId: string, registrable: string): MayEscalate {
  return () => takeBrowserEscalation(workspaceId, registrable, new Date().toISOString().slice(0, 10));
}

function wikidataTerm(subject: Subject): string {
  return subject.registrable.split(".")[0] ?? subject.registrable;
}

async function probeSite(subject: Subject, mayEscalate: MayEscalate): Promise<SiteCard> {
  if (subject.url === null) throw new Error("no site to read");
  const page = await readUrl(subject.url, { mayEscalate });
  if (!page.ok) throw readFailure(page);
  const extract = await extractIdentity(page.html, subject.url);
  const name = await resolveBrandName(extract.nameSources, wikidataTerm(subject));
  const card: SiteCard = {
    name: name?.name ?? null,
    description: extract.description,
    socials: extract.socials,
    logoCandidates: {
      ldOrganizationLogo: extract.ldOrganizationLogo,
      ogImage: extract.ogImage,
      appleTouchIcon: extract.appleTouchIcon,
    },
    adLibraryHints: extract.adLibraryHints,
    navLinks: extract.navLinks,
  };
  if (!hasIdentity(card)) {
    throw new Error(`site read found no name, description or socials (${page.transport} ${String(page.status)})`);
  }
  return card;
}

async function probeProfile(subject: Subject, mayEscalate: MayEscalate): Promise<SiteCard> {
  if (subject.url === null) throw new Error("no profile to read");
  const page = await readUrl(subject.url, { mayEscalate });
  if (!page.ok) throw readFailure(page);
  const extract = await extractIdentity(page.html, subject.url);
  return {
    name: extract.nameSources.title,
    description: extract.description,
    socials: extract.socials,
    logoCandidates: { ldOrganizationLogo: null, ogImage: extract.ogImage, appleTouchIcon: null },
    adLibraryHints: [],
    navLinks: [],
  };
}

function profileProbe(subject: Subject): "youtube-profile" | "instagram-profile" | null {
  if (subject.platform === "youtube") return "youtube-profile";
  if (subject.platform === "instagram") return "instagram-profile";
  return null;
}

function filledProfileFields(card: SiteCard): string[] {
  const filled: string[] = [];
  if (card.name !== null) filled.push("name");
  if (card.description !== null) filled.push("description");
  if (card.socials.length > 0) filled.push("socials");
  if (card.logoCandidates.ogImage !== null) filled.push("avatar");
  return filled;
}

async function readProfileCard(
  subject: Subject,
  mayEscalate: MayEscalate,
): Promise<{ card: SiteCard; reached: boolean }> {
  const probe = profileProbe(subject);
  if (probe === null || subject.url === null) return { card: UNREACHED, reached: false };
  try {
    const card = await cachedProbe(subject, probe, {
      schema: siteCardSchema,
      run: () => probeProfile(subject, mayEscalate),
    });
    console.log(
      JSON.stringify({
        event: "identity-creator-card",
        probe,
        filled: filledProfileFields(card),
      }),
    );
    return { card, reached: true };
  } catch (error) {
    const subjectSha256 = await sha256Hex(subject.registrable);
    console.log(
      JSON.stringify({
        event: unreachedEvent("creator", error),
        probe,
        reason: probeFailureReason(error),
        subjectSha256,
      }),
    );
    return { card: UNREACHED, reached: false };
  }
}

export async function readSiteCard(
  subject: Subject,
  mayEscalate: MayEscalate,
): Promise<{ card: SiteCard; reached: boolean }> {
  if (subject.kind !== "domain") return readProfileCard(subject, mayEscalate);
  try {
    return {
      card: await cachedProbe(subject, "homepage", {
        schema: readSiteCardSchema,
        run: () => probeSite(subject, mayEscalate),
      }),
      reached: true,
    };
  } catch (error) {
    const subjectSha256 = await sha256Hex(subject.registrable);
    console.log(
      JSON.stringify({
        event: unreachedEvent("site", error),
        reason: probeFailureReason(error),
        subjectSha256,
      }),
    );
    return { card: UNREACHED, reached: false };
  }
}

export async function withinProbeLimit(userId: string): Promise<boolean> {
  const { success } = await env.PROBE_LIMIT.limit({ key: `user:${userId}` });
  return success;
}

function fillReview(fields: CardValues): CardReview {
  return {
    name: fields.name === null ? "empty" : "fill",
    description: fields.description === null ? "empty" : "fill",
    socials: fields.socials.length === 0 ? "empty" : "fill",
  };
}

function applyReview(fields: CardValues, review: CardReview): Omit<SiteFields, "unfound"> {
  return {
    ...fields,
    name: review.name === "empty" ? null : fields.name,
    description: review.description === "empty" ? null : fields.description,
    socials: review.socials === "empty" ? [] : fields.socials,
    review,
  };
}

async function firstStorableLogoUrl(candidates: LogoCandidates): Promise<string | null> {
  const registrable = candidates.registrableDomain;
  for (const url of logoCandidateUrls(candidates)) {
    const stored = await storeLogo(registrable, url);
    if (stored !== null) return url;
  }
  return null;
}

function cardValues(subject: Subject, card: SiteCard): CardValues {
  return {
    name: card.name ?? (subject.kind === "domain" ? null : `@${subject.registrable}`),
    description: card.description,
    socials:
      subject.url !== null && subject.kind !== "domain"
        ? [
            { platform: subject.platform ?? "site", url: subject.url },
            ...card.socials.filter((social) => social.platform !== subject.platform),
          ]
        : card.socials,
  };
}

async function logoDataUrl(subject: Subject, card: SiteCard): Promise<string | null> {
  const cached = await cachedProbe(subject, "icon", {
    schema: logoSchema,
    run: async () => {
      const url = await firstStorableLogoUrl({
        ...card.logoCandidates,
        registrableDomain: subject.registrable,
      });
      return { v: ICON_PROBE_V, url };
    },
  });
  const url = cached.url;
  if (url === null) return null;
  const kept = await readLogo(subject.registrable);
  if (kept !== null) {
    const contentType = kept.httpMetadata?.contentType ?? "image/png";
    const bytes = new Uint8Array(await kept.arrayBuffer());
    return toDataUrl(contentType, bytes);
  }
  const stored = await storeLogo(subject.registrable, url);
  if (stored === null) return null;
  return toDataUrl(stored.contentType, stored.bytes);
}

export async function backfillLogo(registrable: string): Promise<R2ObjectBody | null> {
  const normalised = normaliseSubject(registrable);
  if (!normalised.ok || normalised.subject.kind !== "domain") return null;
  const subject = normalised.subject;
  const { card, reached } = await readSiteCard(subject, () => Promise.resolve(false));
  if (!reached) return null;
  await logoDataUrl(subject, card);
  return readLogo(subject.registrable);
}

export function startCard(
  workspaceId: string,
  subject: Subject,
  edited: readonly DraftField[],
): { site: Promise<SiteFields>; logo: Promise<string | null> } {
  const read = readSiteCard(subject, brandBudget(workspaceId, subject.registrable));
  const site = read.then(async ({ card, reached }): Promise<SiteFields> => {
    const values = cardValues(subject, card);
    const review: CardReview = reached
      ? await reviewFields({ workspaceId, subject, fields: values, edited, now: new Date().toISOString() })
      : fillReview(values);
    return { ...applyReview(values, review), unfound: subject.kind === "domain" && !reached };
  });
  const logo = read
    .then(({ card, reached }) => (reached ? logoDataUrl(subject, card) : null))
    .catch((error: unknown) => {
      console.log(JSON.stringify({ event: "identity-logo-failed", workspaceId, error: String(error) }));
      return null;
    });
  return { site, logo };
}

export async function readCachedSiteProof(subject: Subject): Promise<{ adLibraryHints: string[]; navLinks: string[] }> {
  const hit = await env.IDENTITY_CACHE.get(probeKey(subject, "homepage"), "json");
  const parsed = siteCardSchema.safeParse(hit);
  if (!parsed.success) return { adLibraryHints: [], navLinks: [] };
  return { adLibraryHints: parsed.data.adLibraryHints, navLinks: parsed.data.navLinks };
}

export async function readCachedSiteValues(
  subject: Subject,
): Promise<{ name: string | null; description: string | null } | null> {
  const hit = await env.IDENTITY_CACHE.get(probeKey(subject, "homepage"), "json");
  const parsed = siteCardSchema.safeParse(hit);
  if (!parsed.success) return null;
  return { name: parsed.data.name, description: parsed.data.description };
}

function toDataUrl(contentType: string, bytes: Uint8Array): string {
  const base64 = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
  return `data:${contentType};base64,${base64}`;
}
