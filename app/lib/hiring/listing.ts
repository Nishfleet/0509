import type { BoardPlatform } from "./discover-board";
import { z } from "zod";

export interface OpenRole {
  id: string;
  title: string;
  url: string;
  location: string | null;
  team: string | null;
  postedAt: string | null;
}

export class ListingError extends Error {
  readonly platform: BoardPlatform;
  constructor(platform: BoardPlatform, message: string, options?: ErrorOptions) {
    super(`${platform}: ${message}`, options);
    this.name = "ListingError";
    this.platform = platform;
  }
}

function title(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, 200);
}

function httpsUrl(value: string | null | undefined, boardUrl: string): string {
  if (typeof value !== "string") return boardUrl;
  if (!URL.canParse(value)) return boardUrl;
  const parsed = new URL(value);
  return parsed.protocol === "https:" ? parsed.href : boardUrl;
}

function isoDate(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function text(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function parseBody(platform: BoardPlatform, body: string): unknown {
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new ListingError(platform, "body is not JSON", { cause: error });
  }
}

const greenhouseTopSchema = z.object({ jobs: z.array(z.unknown()) });
const greenhouseRowSchema = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string().nullish(),
  absolute_url: z.string().nullish(),
  location: z.object({ name: z.string().nullish() }).nullish(),
  first_published: z.string().nullish(),
});

const leverTopSchema = z.array(z.unknown());
const leverRowSchema = z.object({
  id: z.string(),
  text: z.string().nullish(),
  hostedUrl: z.string().nullish(),
  createdAt: z.number().nullish(),
  categories: z.object({
    location: z.string().nullish(),
    team: z.string().nullish(),
  }).nullish(),
});

export function parseListing(platform: BoardPlatform, body: string, boardUrl: string): OpenRole[] {
  if (platform === "ashby" || platform === "workable" || platform === "smartrecruiters") {
    throw new ListingError(platform, "not supported yet");
  }

  const parsed = parseBody(platform, body);

  if (platform === "greenhouse") {
    const top = greenhouseTopSchema.safeParse(parsed);
    if (!top.success) throw new ListingError(platform, "unexpected listing shape");
    return top.data.jobs.flatMap((row) => {
      const rowParsed = greenhouseRowSchema.safeParse(row);
      if (!rowParsed.success) return [];
      const r = rowParsed.data;
      const t = title(r.title);
      if (t === null) return [];
      return [{
        id: String(r.id),
        title: t,
        url: httpsUrl(r.absolute_url, boardUrl),
        location: text(r.location?.name),
        team: null,
        postedAt: isoDate(r.first_published),
      }];
    });
  }

  const top = leverTopSchema.safeParse(parsed);
  if (!top.success) throw new ListingError(platform, "unexpected listing shape");
  return top.data.flatMap((row) => {
    const rowParsed = leverRowSchema.safeParse(row);
    if (!rowParsed.success) return [];
    const r = rowParsed.data;
    const t = title(r.text);
    if (t === null) return [];
    return [{
      id: r.id,
      title: t,
      url: httpsUrl(r.hostedUrl, boardUrl),
      location: text(r.categories?.location),
      team: text(r.categories?.team),
      postedAt: isoDate(r.createdAt),
    }];
  });
}
