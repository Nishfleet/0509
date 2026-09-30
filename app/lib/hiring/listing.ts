import { z } from "zod";

export const BOARD_PLATFORMS = ["greenhouse", "lever", "ashby", "workable", "smartrecruiters"] as const;

export type BoardPlatform = (typeof BOARD_PLATFORMS)[number];

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
  categories: z
    .object({
      location: z.string().nullish(),
      team: z.string().nullish(),
    })
    .nullish(),
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
  location: z
    .object({
      city: z.string().nullish(),
      country: z.string().nullish(),
    })
    .nullish(),
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

type RoleParser = (parsed: unknown, boardUrl: string) => OpenRole[];

function rolesFrom<R>(
  rows: readonly unknown[],
  rowSchema: z.ZodType<R>,
  toRole: (row: R) => OpenRole | null,
): OpenRole[] {
  return rows.flatMap((row) => {
    const rowParsed = rowSchema.safeParse(row);
    if (!rowParsed.success) return [];
    const role = toRole(rowParsed.data);
    return role === null ? [] : [role];
  });
}

function joinedLocation(parts: readonly (string | null)[]): string | null {
  const present = parts.filter((part) => part !== null);
  return present.length === 0 ? null : present.join(", ");
}

const parseSmartRecruiters: RoleParser = (parsed, boardUrl) => {
  const top = smartRecruitersTopSchema.safeParse(parsed);
  if (!top.success) throw new ListingError("smartrecruiters", "unexpected listing shape");
  const slug = boardSlug(boardUrl);
  return rolesFrom(top.data.content, smartRecruitersRowSchema, (r) => {
    const t = title(r.name) ?? title(r.title);
    if (t === null) return null;
    return {
      id: r.id,
      title: t,
      url:
        slug === null
          ? boardUrl
          : httpsUrl(`${SMARTRECRUITERS_JOBS_ORIGIN}/${slug}/${encodeURIComponent(r.id)}`, boardUrl),
      location: joinedLocation([text(r.location?.city), text(r.location?.country)]),
      team: text(r.department?.label),
      postedAt: isoDate(r.releasedDate),
    };
  });
};

const parseGreenhouse: RoleParser = (parsed, boardUrl) => {
  const top = greenhouseTopSchema.safeParse(parsed);
  if (!top.success) throw new ListingError("greenhouse", "unexpected listing shape");
  return rolesFrom(top.data.jobs, greenhouseRowSchema, (r) => {
    const t = title(r.title);
    if (t === null) return null;
    return {
      id: String(r.id),
      title: t,
      url: httpsUrl(r.absolute_url, boardUrl),
      location: text(r.location?.name),
      team: null,
      postedAt: isoDate(r.first_published),
    };
  });
};

const parseAshby: RoleParser = (parsed, boardUrl) => {
  const top = ashbyTopSchema.safeParse(parsed);
  if (!top.success) throw new ListingError("ashby", "unexpected listing shape");
  return rolesFrom(top.data.jobs, ashbyRowSchema, (r) => {
    if (r.isListed === false) return null;
    const t = title(r.title);
    if (t === null) return null;
    return {
      id: r.id ?? r.jobUrl,
      title: t,
      url: httpsUrl(r.jobUrl, boardUrl),
      location: text(r.location),
      team: text(r.team) ?? text(r.department),
      postedAt: isoDate(r.publishedAt),
    };
  });
};

const parseWorkable: RoleParser = (parsed, boardUrl) => {
  const top = workableTopSchema.safeParse(parsed);
  if (!top.success) throw new ListingError("workable", "unexpected listing shape");
  return rolesFrom(top.data.jobs, workableRowSchema, (r) => {
    const t = title(r.title);
    if (t === null) return null;
    return {
      id: r.shortcode,
      title: t,
      url: httpsUrl(r.url ?? r.shortlink, boardUrl),
      location: joinedLocation([text(r.city), text(r.country)]),
      team: text(r.department),
      postedAt: isoDate(r.published_on),
    };
  });
};

const parseLever: RoleParser = (parsed, boardUrl) => {
  const top = leverTopSchema.safeParse(parsed);
  if (!top.success) throw new ListingError("lever", "unexpected listing shape");
  return rolesFrom(top.data, leverRowSchema, (r) => {
    const t = title(r.text);
    if (t === null) return null;
    return {
      id: r.id,
      title: t,
      url: httpsUrl(r.hostedUrl, boardUrl),
      location: text(r.categories?.location),
      team: text(r.categories?.team),
      postedAt: isoDate(r.createdAt),
    };
  });
};

const ROLE_PARSERS: Record<BoardPlatform, RoleParser> = {
  smartrecruiters: parseSmartRecruiters,
  greenhouse: parseGreenhouse,
  ashby: parseAshby,
  workable: parseWorkable,
  lever: parseLever,
};

export function parseListing(platform: BoardPlatform, body: string, boardUrl: string): OpenRole[] {
  return ROLE_PARSERS[platform](parseBody(platform, body), boardUrl);
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
