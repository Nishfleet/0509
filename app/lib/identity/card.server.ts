import { env } from "cloudflare:workers";
import { z } from "zod";

import { readUrl } from "../fetch/transport.server";
import type { CardReview, CardValues, SiteFields } from "./card-fields";
import { extractIdentity } from "./extract";
import { reviewFields } from "./field-confidence.server";
import { readLogo, storeLogo } from "./logo-store.server";
import { resolveLogo } from "./logo-cascade";
import { resolveBrandName } from "./name-cascade";
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

const logoSchema = z.object({ url: z.string().nullable() });

const UNREACHED: SiteCard = {
  name: null,
  description: null,
  socials: [],
  logoCandidates: { ldOrganizationLogo: null, ogImage: null, appleTouchIcon: null },
  adLibraryHints: [],
  navLinks: [],
};

function wikidataTerm(subject: Subject): string {
  return subject.registrable.split(".")[0] ?? subject.registrable;
}

async function probeSite(subject: Subject): Promise<SiteCard> {
  if (subject.url === null) throw new Error("no site to read");
  const page = await readUrl(subject.url);
  if (!page.ok) throw new Error(page.detail);
  const extract = await extractIdentity(page.html, subject.url);
  const name = await resolveBrandName(extract.nameSources, wikidataTerm(subject));
  return {
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
}

export async function readSiteCard(subject: Subject): Promise<{ card: SiteCard; reached: boolean }> {
  if (subject.kind === "handle" || subject.url === null) return { card: UNREACHED, reached: false };
  try {
    return { card: await cachedProbe(subject, "homepage", siteCardSchema, () => probeSite(subject)), reached: true };
  } catch (error) {
    console.log(JSON.stringify({ event: "identity-site-unreached", subject: subject.registrable, error: String(error) }));
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

export function startCard(
  workspaceId: string,
  subject: Subject,
): { site: Promise<SiteFields>; logo: Promise<string | null> } {
  const read = readSiteCard(subject);
  const site = read.then(async ({ card, reached }): Promise<SiteFields> => {
    const subjectSocial = subject.kind !== "domain" && subject.url !== null
      ? [{ platform: subject.platform ?? "site", url: subject.url }, ...card.socials.filter((social) => social.url !== subject.url)]
      : card.socials;
    const values: CardValues = {
      name: card.name ?? (subject.kind === "domain" ? null : `@${subject.registrable}`),
      description: card.description,
      socials: subjectSocial,
    };
    const review: CardReview = subject.kind === "domain" && reached
      ? await reviewFields(workspaceId, subject, values, new Date().toISOString())
      : fillReview(values);
    return { ...applyReview(values, review), unfound: subject.kind === "domain" && !reached };
  });
  const logo = read.then(async ({ card, reached }) => {
    if (!reached || subject.kind !== "domain") return null;
    const cached = await cachedProbe(subject, "icon", logoSchema, async () => {
      const result = await resolveLogo({ ...card.logoCandidates, registrableDomain: subject.registrable });
      return { url: result.ok ? result.url : null };
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
  }).catch((error: unknown) => {
    console.log(JSON.stringify({ event: "identity-logo-failed", subject: subject.registrable, error: String(error) }));
    return null;
  });
  return { site, logo };
}

export async function readCachedSiteProof(
  subject: Subject,
): Promise<{ adLibraryHints: string[]; navLinks: string[] }> {
  const hit = await env.IDENTITY_CACHE.get(probeKey(subject, "homepage"), "json");
  if (hit === null) return { adLibraryHints: [], navLinks: [] };
  const parsed = siteCardSchema.parse(hit);
  return { adLibraryHints: parsed.adLibraryHints, navLinks: parsed.navLinks };
}

function toDataUrl(contentType: string, bytes: Uint8Array): string {
  const base64 = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
  return `data:${contentType};base64,${base64}`;
}
