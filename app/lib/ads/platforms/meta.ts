import { z } from "zod";

const creativeSchema = z.object({
  platformCreativeId: z.string().regex(/^\d+$/),
  copy: z.string(),
  mediaUrls: z.array(z.url()),
  firstSeen: z.iso.datetime(),
  lastSeen: z.iso.datetime().nullable(),
  format: z.string().min(1),
  landingUrl: z.url().nullable(),
});

export type Creative = z.infer<typeof creativeSchema>;

interface RawAd {
  adArchiveId: string;
  startSeconds: number;
  endSeconds: number | null;
  snapshot: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function jsonScriptBodies(html: string): Promise<string[]> {
  const bodies: string[] = [];
  let capture = false;
  let buffer = "";
  const rewriter = new HTMLRewriter().on("script", {
    element(element) {
      capture = element.getAttribute("type") === "application/json";
      buffer = "";
    },
    text(chunk) {
      if (!capture) {
        return;
      }
      buffer += chunk.text;
      if (chunk.lastInTextNode) {
        bodies.push(buffer);
        buffer = "";
      }
    },
  });
  await rewriter.transform(new Response(html)).arrayBuffer();
  return bodies;
}

function asRawAd(value: Record<string, unknown>): RawAd | null {
  const id = value.ad_archive_id;
  if (typeof id !== "string" || !/^\d+$/.test(id)) {
    return null;
  }
  if (!isRecord(value.snapshot)) {
    return null;
  }
  if (typeof value.start_date !== "number" || !Number.isFinite(value.start_date)) {
    return null;
  }
  const end = value.end_date;
  const endSeconds =
    typeof end === "number" && Number.isFinite(end) && end > 0 ? end : null;
  return {
    adArchiveId: id,
    startSeconds: value.start_date,
    endSeconds,
    snapshot: value.snapshot,
  };
}

function collectRawAds(value: unknown, out: RawAd[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectRawAds(item, out);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  if ("ad_archive_id" in value && "snapshot" in value) {
    const raw = asRawAd(value);
    if (raw) {
      out.push(raw);
    }
    return;
  }
  for (const child of Object.values(value)) {
    collectRawAds(child, out);
  }
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function pushImage(urls: string[], value: unknown): void {
  if (!isRecord(value)) {
    return;
  }
  const url = httpUrl(value.original_image_url) ?? httpUrl(value.resized_image_url);
  if (url) {
    urls.push(url);
  }
}

function pushVideo(urls: string[], value: unknown): void {
  if (!isRecord(value)) {
    return;
  }
  const play = httpUrl(value.video_hd_url) ?? httpUrl(value.video_sd_url);
  if (play) {
    urls.push(play);
  }
  const preview = httpUrl(value.video_preview_image_url);
  if (preview) {
    urls.push(preview);
  }
}

function mediaUrls(snapshot: Record<string, unknown>): string[] {
  const urls: string[] = [];
  if (Array.isArray(snapshot.images)) {
    for (const image of snapshot.images) {
      pushImage(urls, image);
    }
  }
  if (Array.isArray(snapshot.videos)) {
    for (const video of snapshot.videos) {
      pushVideo(urls, video);
    }
  }
  if (Array.isArray(snapshot.cards)) {
    for (const card of snapshot.cards) {
      pushImage(urls, card);
      pushVideo(urls, card);
    }
  }
  if (Array.isArray(snapshot.extra_images)) {
    for (const image of snapshot.extra_images) {
      pushImage(urls, image);
    }
  }
  if (Array.isArray(snapshot.extra_videos)) {
    for (const video of snapshot.extra_videos) {
      pushVideo(urls, video);
    }
  }
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const url of urls) {
    if (seen.has(url)) {
      continue;
    }
    seen.add(url);
    unique.push(url);
  }
  return unique;
}

function copyOf(snapshot: Record<string, unknown>): string {
  if (isRecord(snapshot.body) && typeof snapshot.body.text === "string") {
    const text = snapshot.body.text.trim();
    if (text.length > 0) {
      return text;
    }
  }
  if (!Array.isArray(snapshot.cards)) {
    return "";
  }
  const parts: string[] = [];
  for (const card of snapshot.cards) {
    if (!isRecord(card)) {
      continue;
    }
    if (typeof card.body === "string" && card.body.trim().length > 0) {
      parts.push(card.body.trim());
      continue;
    }
    if (
      isRecord(card.body) &&
      typeof card.body.text === "string" &&
      card.body.text.trim().length > 0
    ) {
      parts.push(card.body.text.trim());
    }
  }
  return parts.join("\n");
}

function landingOf(snapshot: Record<string, unknown>): string | null {
  const direct = httpUrl(snapshot.link_url);
  if (direct) {
    return direct;
  }
  if (!Array.isArray(snapshot.cards)) {
    return null;
  }
  for (const card of snapshot.cards) {
    if (!isRecord(card)) {
      continue;
    }
    const url = httpUrl(card.link_url);
    if (url) {
      return url;
    }
  }
  return null;
}

function formatOf(snapshot: Record<string, unknown>): string | null {
  if (typeof snapshot.display_format !== "string" || snapshot.display_format.length === 0) {
    return null;
  }
  return snapshot.display_format;
}

function unixToUtc(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function toCreative(raw: RawAd): Creative | null {
  const parsed = creativeSchema.safeParse({
    platformCreativeId: raw.adArchiveId,
    copy: copyOf(raw.snapshot),
    mediaUrls: mediaUrls(raw.snapshot),
    firstSeen: unixToUtc(raw.startSeconds),
    lastSeen: raw.endSeconds === null ? null : unixToUtc(raw.endSeconds),
    format: formatOf(raw.snapshot),
    landingUrl: landingOf(raw.snapshot),
  });
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
}

export async function mapMeta(payload: string): Promise<Creative[]> {
  const bodies = await jsonScriptBodies(payload);
  const raw: RawAd[] = [];
  for (const body of bodies) {
    try {
      collectRawAds(JSON.parse(body) as unknown, raw);
    } catch (error) {
      if (error instanceof SyntaxError) {
        continue;
      }
      throw error;
    }
  }
  const seen = new Set<string>();
  const creatives: Creative[] = [];
  for (const ad of raw) {
    if (seen.has(ad.adArchiveId)) {
      continue;
    }
    seen.add(ad.adArchiveId);
    const creative = toCreative(ad);
    if (creative) {
      creatives.push(creative);
    }
  }
  return creatives;
}
