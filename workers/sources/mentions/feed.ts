import { extractFromXml } from "@extractus/feed-extractor";
import type { FeedEntry } from "@extractus/feed-extractor";

export function feedEntries(xml: string): FeedEntry[] {
  try {
    const data = extractFromXml(xml, {
      descriptionMaxLen: 600,
      getExtraEntryFields: (entry) => ({
        source: entry.source,
        author: entry.author,
        updated: entry.updated,
        videoId: entry["yt:videoId"],
        mediaGroup: entry["media:group"],
      }),
    });
    return data.entries ?? [];
  } catch {
    return [];
  }
}

export function textOf(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (!value || typeof value !== "object") return null;
  if ("name" in value) {
    const name = textOf(value.name);
    if (name) return name;
  }
  if ("#text" in value) return textOf(value["#text"]);
  if ("_text" in value) return textOf(value._text);
  return null;
}

export function publisherHost(source: unknown): string | null {
  if (!source || typeof source !== "object") return null;
  const urlValue = "url" in source ? source.url : "@_url" in source ? source["@_url"] : null;
  const url = typeof urlValue === "string" ? urlValue : null;
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export function blankToNull(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function viewsFromMedia(mediaGroup: unknown): number | null {
  if (!mediaGroup || typeof mediaGroup !== "object") return null;
  const community = "media:community" in mediaGroup ? mediaGroup["media:community"] : null;
  if (!community || typeof community !== "object") return null;
  const statistics = "media:statistics" in community ? community["media:statistics"] : null;
  if (!statistics || typeof statistics !== "object") return null;
  const views = "@_views" in statistics ? statistics["@_views"] : null;
  if (typeof views !== "string") return null;
  const parsed = Number(views);
  return Number.isFinite(parsed) ? parsed : null;
}
