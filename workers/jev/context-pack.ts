import { z } from "zod";

export interface MentionSubject {
  name: string;
  domain: string;
  role: string;
}

export interface PackedMentionItem {
  title: string;
  publisher: string | null;
  url: string;
  published_at: string | null;
  reliability: string;
  url_hash: string;
  title_hash: string;
}

export interface PackedOtherMention {
  id: string;
  kind: "mention";
  title: string;
  url: string;
  date: string;
  url_hash: string;
  title_hash: string;
}

export interface DuplicatePack {
  subject: MentionSubject;
  item: PackedMentionItem;
  other: PackedOtherMention;
}

export interface Sighting {
  source_id: string;
  url: string;
  title: string;
  seen_at: string;
}

export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim();
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isGoogleNewsUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "news.google.com" || host.endsWith(".news.google.com");
  } catch (error) {
    console.error(JSON.stringify({ event: "mentions.url_unreadable", message: String(error) }));
    return false;
  }
}

export function canonicalAfterCollapse(existingUrl: string, incomingUrl: string): string {
  if (isGoogleNewsUrl(existingUrl) && !isGoogleNewsUrl(incomingUrl)) return incomingUrl;
  return existingUrl;
}

export function packDuplicate(input: {
  subject: MentionSubject;
  item: PackedMentionItem;
  other: PackedOtherMention;
}): DuplicatePack {
  return { subject: input.subject, item: input.item, other: input.other };
}

const engagementSchema = z.object({ sightings: z.array(z.unknown()).optional() }).catchall(z.unknown());

function readEngagement(existing: string | null): Record<string, unknown> {
  if (existing === null || existing === "") return {};
  try {
    const parsed: unknown = JSON.parse(existing);
    const engagement = engagementSchema.safeParse(parsed);
    if (engagement.success) return engagement.data;
  } catch (error) {
    console.error(JSON.stringify({ event: "mentions.engagement_unreadable", message: String(error) }));
  }
  return {};
}

export function appendSighting(existing: string | null, sighting: Sighting): string {
  const base = readEngagement(existing);
  const prior = base.sightings ?? [];
  return JSON.stringify({ ...base, sightings: [...prior, sighting] });
}
