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

function boardSlug(boardUrl: string): string | null {
  if (!URL.canParse(boardUrl)) return null;
  const segment = new URL(boardUrl).pathname.split("/").find((part) => part.length > 0);
  return segment ?? null;
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

const ashbyTopSchema = z.object({ jobs: z.array(z.unknown()) });
const ashbyRowSchema = z.object({
  id: z.string().nullish(),
  title: z.string().nullish(),
  jobUrl: z.string(),
  location: z.string().nullish(),
  team: z.string().nullish(),
  department: z.string().nullish(),
  publishedAt: z.string().nullish(),
  isListed: z.boolean().nullish(),
});

const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const SMARTRECRUITERS_JOBS_ORIGIN = "https://jobs.smartrecruiters.com";

const smartRecruitersTopSchema = z.object({
  offset: z.number(),
  totalFound: z.number(),
  content: z.array(z.unknown()),
});
const smartRecruitersRowSchema = z.object({
  id: z.string(),
  name: z.string().nullish(),
  title: z.string().nullish(),
  releasedDate: z.string().nullish(),
  location: z.object({
    city: z.string().nullish(),
    country: z.string().nullish(),
  }).nullish(),
  department: z.object({ label: z.string().nullish() }).nullish(),
});

const workableTopSchema = z.object({ jobs: z.array(z.unknown()) });
const workableRowSchema = z.object({
  shortcode: z.string(),
  title: z.string().nullish(),
  url: z.string().nullish(),
  shortlink: z.string().nullish(),
  city: z.string().nullish(),
  country: z.string().nullish(),
  department: z.string().nullish(),
  published_on: z.string().nullish(),
});

export function parseListing(platform: BoardPlatform, body: string, boardUrl: string): OpenRole[] {
  const parsed = parseBody(platform, body);

  if (platform === "smartrecruiters") {
    const top = smartRecruitersTopSchema.safeParse(parsed);
    if (!top.success) throw new ListingError(platform, "unexpected listing shape");
    const slug = boardSlug(boardUrl);
    return top.data.content.flatMap((row) => {
      const rowParsed = smartRecruitersRowSchema.safeParse(row);
      if (!rowParsed.success) return [];
      const r = rowParsed.data;
      const t = title(r.name) ?? title(r.title);
      if (t === null) return [];
      const location = [text(r.location?.city), text(r.location?.country)].filter((part) => part !== null);
      return [{
        id: r.id,
        title: t,
        url: slug === null ? boardUrl : httpsUrl(`${SMARTRECRUITERS_JOBS_ORIGIN}/${slug}/${encodeURIComponent(r.id)}`, boardUrl),
        location: location.length === 0 ? null : location.join(", "),
        team: text(r.department?.label),
        postedAt: isoDate(r.releasedDate),
      }];
    });
  }

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

  if (platform === "ashby") {
    const top = ashbyTopSchema.safeParse(parsed);
    if (!top.success) throw new ListingError(platform, "unexpected listing shape");
    return top.data.jobs.flatMap((row) => {
      const rowParsed = ashbyRowSchema.safeParse(row);
      if (!rowParsed.success) return [];
      const r = rowParsed.data;
      if (r.isListed === false) return [];
      const t = title(r.title);
      if (t === null) return [];
      return [{
        id: r.id ?? r.jobUrl,
        title: t,
        url: httpsUrl(r.jobUrl, boardUrl),
        location: text(r.location),
        team: text(r.team) ?? text(r.department),
        postedAt: isoDate(r.publishedAt),
      }];
    });
  }

  if (platform === "workable") {
    const top = workableTopSchema.safeParse(parsed);
    if (!top.success) throw new ListingError(platform, "unexpected listing shape");
    return top.data.jobs.flatMap((row) => {
      const rowParsed = workableRowSchema.safeParse(row);
      if (!rowParsed.success) return [];
      const r = rowParsed.data;
      const t = title(r.title);
      if (t === null) return [];
      const location = [text(r.city), text(r.country)].filter((part) => part !== null);
      return [{
        id: r.shortcode,
        title: t,
        url: httpsUrl(r.url ?? r.shortlink, boardUrl),
        location: location.length === 0 ? null : location.join(", "),
        team: text(r.department),
        postedAt: isoDate(r.published_on),
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

export function nextListingUrl(platform: BoardPlatform, listingUrl: string, body: string): string | null {
  if (platform !== "smartrecruiters") return null;
  const top = smartRecruitersTopSchema.safeParse(parseBody(platform, body));
  if (!top.success) throw new ListingError(platform, "unexpected listing shape");
  const nextOffset = top.data.offset + top.data.content.length;
  if (top.data.content.length === 0) return null;
  if (nextOffset >= top.data.totalFound) return null;
  if (nextOffset >= PAGE_SIZE * MAX_PAGES) return null;
  const next = new URL(listingUrl);
  next.searchParams.set("limit", String(PAGE_SIZE));
  next.searchParams.set("offset", String(nextOffset));
  return next.href;
}
