import { nowIso } from "~/lib/data/helpers.server";
import type { JsonRecord } from "~/lib/data/helpers.server";
import type { JobBoardProvider } from "~/lib/sources/hiring/job-board-discovery.server";

/**
 * Job feed fetching + normalization (#2199).
 *
 * One fetch per board, 20s AbortController, ONE attempt, no in-app retry —
 * a timeout/down feed returns `{ unavailable: true, reason }` and is never
 * retried inside the app. An unknown slug on any provider returns HTTP 404,
 * which means "not this provider / no board here", surfaced as
 * `reason: "not_found"` (NOT "no jobs").
 *
 * Normalized shape: `{ id, title, location, department, url, postedAt }`.
 * No `content=true` (no job-description fetches), no LinkedIn/Indeed/careers
 * HTML scraping for job CONTENT — the public feed JSON only.
 *
 * Each provider's fetch+normalize is a separate exported function taking an
 * injected `fetchFn` so tests can fake the wire. `fetchJobs` dispatches on
 * `{ provider, slug }` and wraps the jobs in the snapshot payload shape.
 */

const FETCH_TIMEOUT_MS = 20_000;

export type FetchFn = (
  url: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface HiringJob {
  id: string;
  title: string;
  location: string | null;
  department: string | null;
  url: string | null;
  postedAt: string | null;
}

export interface HiringCounts {
  byDepartment: Record<string, number>;
  byLocation: Record<string, number>;
}

/** Provider-specific fetch outcome (raw jobs). */
export type JobsFetch =
  | { jobs: HiringJob[] }
  | { unavailable: true; reason: string; status?: number };

/** Dispatcher outcome: the wrapped snapshot payload ready to store. */
export type FetchJobsResult =
  | {
      unavailable?: false;
      provider: JobBoardProvider;
      slug: string;
      fetchedAt: string;
      jobs: HiringJob[];
      counts: HiringCounts;
    }
  | { unavailable: true; reason: string; status?: number };

const defaultFetch: FetchFn = (url, init) => globalThis.fetch(url, init);

const GREENHOUSE_API = "https://boards-api.greenhouse.io";
const ASHBY_API = "https://api.ashbyhq.com";
const LEVER_API = "https://api.lever.co";

export interface BoardRef {
  provider: JobBoardProvider;
  slug: string;
}

export function buildJobFeedUrl(board: BoardRef): string {
  switch (board.provider) {
    case "greenhouse":
      return `${GREENHOUSE_API}/v1/boards/${board.slug}/jobs?content=false`;
    case "ashby":
      return `${ASHBY_API}/posting-api/job-board/${board.slug}`;
    case "lever":
      return `${LEVER_API}/v0/postings/${board.slug}?mode=json`;
  }
}

/**
 * Fetch + normalize Greenhouse jobs. Greenhouse: `jobs[].{id, title,
 * location.name, departments/offices, absolute_url, updated_at}`. No
 * `content=true`. Returns raw jobs or unavailable.
 */
export async function fetchGreenhouseJobs(
  slug: string,
  fetchFn: FetchFn = defaultFetch,
): Promise<JobsFetch> {
  const url = buildJobFeedUrl({ provider: "greenhouse", slug });
  const body = await fetchJsonBody(url, fetchFn);
  if ("unavailable" in body) return body;
  return parseGreenhouseBody(body.value);
}

export async function fetchAshbyJobs(
  slug: string,
  fetchFn: FetchFn = defaultFetch,
): Promise<JobsFetch> {
  const url = buildJobFeedUrl({ provider: "ashby", slug });
  const body = await fetchJsonBody(url, fetchFn);
  if ("unavailable" in body) return body;
  return parseAshbyBody(body.value);
}

export async function fetchLeverJobs(
  slug: string,
  fetchFn: FetchFn = defaultFetch,
): Promise<JobsFetch> {
  const url = buildJobFeedUrl({ provider: "lever", slug });
  const body = await fetchJsonBody(url, fetchFn);
  if ("unavailable" in body) return body;
  return parseLeverBody(body.value);
}

/**
 * Parse an already-downloaded Greenhouse feed body (`{ jobs: [...] }`).
 * Exported so a discovery probe can hand its response straight in — the probe
 * URL IS this feed URL, so a second request would be a pure duplicate.
 */
export function parseGreenhouseBody(value: unknown): JobsFetch {
  const v = asRecord(value);
  const jobs =
    v && Array.isArray(v.jobs) ? (v.jobs as unknown[]) : null;
  if (!jobs) return { unavailable: true, reason: "parse_break" };
  const normalized = jobs
    .map((raw) => normalizeGreenhouse(raw))
    .filter((j): j is HiringJob => j !== null);
  return { jobs: normalized };
}

/** Parse an already-downloaded Ashby feed body (`{ jobs: [...] }`). */
export function parseAshbyBody(value: unknown): JobsFetch {
  const v = asRecord(value);
  const jobs =
    v && Array.isArray(v.jobs) ? (v.jobs as unknown[]) : null;
  if (!jobs) return { unavailable: true, reason: "parse_break" };
  const normalized = jobs
    .map((raw) => normalizeAshby(raw))
    .filter((j): j is HiringJob => j !== null);
  return { jobs: normalized };
}

/** Parse an already-downloaded Lever feed body (a bare postings array). */
export function parseLeverBody(value: unknown): JobsFetch {
  const jobs = Array.isArray(value) ? (value as unknown[]) : null;
  if (!jobs) return { unavailable: true, reason: "parse_break" };
  const normalized = jobs
    .map((raw) => normalizeLever(raw))
    .filter((j): j is HiringJob => j !== null);
  return { jobs: normalized };
}

function parseJobsBody(provider: JobBoardProvider, value: unknown): JobsFetch {
  switch (provider) {
    case "greenhouse":
      return parseGreenhouseBody(value);
    case "ashby":
      return parseAshbyBody(value);
    case "lever":
      return parseLeverBody(value);
  }
}

/**
 * Dispatcher on `{ provider, slug }`. Per-provider fetch+normalize, then wraps
 * into the snapshot payload shape: normalized jobs + provider + slug +
 * fetchedAt + counts. Unavailable (incl. 404 => reason "not_found") passes
 * through unwrapped.
 */
export async function fetchJobs(
  board: BoardRef,
  fetchFn: FetchFn = defaultFetch,
  prefetchedBody?: unknown,
): Promise<FetchJobsResult> {
  // A domain-label discovery probe already requested this exact feed URL; when
  // its body is handed in as `prefetchedBody` the feed is NOT fetched again —
  // one request per weekly check instead of two (#2624).
  const raw: JobsFetch =
    prefetchedBody !== undefined
      ? parseJobsBody(board.provider, prefetchedBody)
      : board.provider === "greenhouse"
        ? await fetchGreenhouseJobs(board.slug, fetchFn)
        : board.provider === "ashby"
          ? await fetchAshbyJobs(board.slug, fetchFn)
          : await fetchLeverJobs(board.slug, fetchFn);
  if ("unavailable" in raw) return raw;
  const fetchedAt = nowIso();
  return {
    provider: board.provider,
    slug: board.slug,
    fetchedAt,
    jobs: raw.jobs,
    counts: computeCounts(raw.jobs),
  };
}

/** Count jobs by department and by location (null/empty groups bucket to "(none)"
 * for departments and "(not listed)" for locations — never a location claim
 * such as "(remote)" that the job posting does not actually make). */
export function computeCounts(jobs: HiringJob[]): HiringCounts {
  const byDepartment: Record<string, number> = {};
  const byLocation: Record<string, number> = {};
  for (const job of jobs) {
    const dept = clean(job.department) ?? "(none)";
    const loc = clean(job.location) ?? "(not listed)";
    byDepartment[dept] = (byDepartment[dept] ?? 0) + 1;
    byLocation[loc] = (byLocation[loc] ?? 0) + 1;
  }
  return { byDepartment, byLocation };
}

/* --------------------------- normalizers --------------------------- */

function normalizeGreenhouse(raw: unknown): HiringJob | null {
  const j = asRecord(raw);
  if (!j) return null;
  const id = scalarString(j.id);
  if (!id) return null;
  return {
    id,
    title: scalarString(j.title) ?? "",
    location: locationName(j.location),
    department: greenhouseDepartment(j),
    url: httpUrl(j.absolute_url) ?? null,
    postedAt:
      postedAtIso(j.last_updated_at) ??
      postedAtIso(j.updated_at) ??
      postedAtIso(j.created_at) ??
      null,
  };
}

function greenhouseDepartment(j: JsonRecord): string | null {
  const departments = Array.isArray(j.departments)
    ? (j.departments as unknown[])
    : j.department
      ? [j.department]
      : [];
  const names = departments
    .map((d) => scalarString(asRecord(d)?.name) ?? scalarString(d))
    .filter((n): n is string => Boolean(n));
  if (names.length > 0) return names.join(", ");
  // Fall back to the office location as a department-ish descriptor.
  const offices = Array.isArray(j.offices)
    ? (j.offices as unknown[])
        .map((o) => scalarString(asRecord(o)?.name))
        .filter((n): n is string => Boolean(n))
    : [];
  return offices.length > 0 ? offices[0] : null;
}

function normalizeAshby(raw: unknown): HiringJob | null {
  const j = asRecord(raw);
  if (!j) return null;
  const id = scalarString(j.id);
  if (!id) return null;
  return {
    id,
    title: scalarString(j.title) ?? "",
    location: locationName(j.location),
    department: ashbyDepartment(j),
    url: httpUrl(j.jobUrl) ?? null,
    postedAt: postedAtIso(j.publishedAt),
  };
}

/**
 * Live Ashby posting-api returns `department` and `team` as plain strings
 * (confirmed against api.ashbyhq.com/posting-api 2026-09-20 — #2624); earlier
 * fixtures modelled them as `{ name }` objects. Accept both shapes so a
 * string team still lands instead of silently dropping to "(none)".
 */
function ashbyDepartment(j: JsonRecord): string | null {
  return (
    scalarString(j.department) ??
    scalarString(asRecord(j.department)?.name) ??
    scalarString(j.team) ??
    scalarString(asRecord(j.team)?.name) ??
    null
  );
}

function normalizeLever(raw: unknown): HiringJob | null {
  const j = asRecord(raw);
  if (!j) return null;
  const id = scalarString(j.id);
  if (!id) return null;
  const cats = asRecord(j.categories);
  return {
    id,
    title: scalarString(j.text) ?? "",
    location: cats ? scalarString(cats.location, false) : null,
    department:
      (cats ? scalarString(cats.department, false) : null) ??
      (cats ? scalarString(cats.team, false) : null),
    url: httpUrl(j.hostedUrl) ?? null,
    postedAt: postedAtIso(j.createdAt),
  };
}

/* --------------------------- wire helper --------------------------- */

type JsonBody =
  | { value: unknown }
  | { unavailable: true; reason: string; status?: number };

async function fetchJsonBody(
  url: string,
  fetchFn: FetchFn,
): Promise<JsonBody> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchFn(url, { signal: controller.signal });
  } catch {
    clearTimeout(timer);
    return { unavailable: true, reason: "fetch_failed" };
  }
  clearTimeout(timer);
  if (!res.ok) {
    if (res.status === 404) {
      return { unavailable: true, reason: "not_found", status: 404 };
    }
    return { unavailable: true, reason: "fetch_error", status: res.status };
  }
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    return { unavailable: true, reason: "parse_break" };
  }
  return { value: parsed };
}

/* --------------------------- scalar helpers --------------------------- */

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function scalarString(value: unknown, allowEmpty = true): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const t = value.trim();
    if (!allowEmpty && t === "") return null;
    return t || null;
  }
  if (typeof value === "number") return String(value);
  return null;
}

/**
 * Normalize a posting timestamp to ISO. Lever's `createdAt` is epoch
 * milliseconds as a number (confirmed live 2026-09-20 — #2624); a bare
 * numeric string of 10+ digits is treated the same so an epoch never reaches
 * the snapshot as a number-string. Already-string values (ISO or similar)
 * pass through.
 */
function postedAtIso(value: unknown): string | null {
  if (typeof value === "number") return epochMsToIso(value);
  const s = scalarString(value);
  if (!s) return null;
  if (/^\d{10,}$/.test(s)) return epochMsToIso(Number(s));
  return s;
}

function epochMsToIso(ms: number): string | null {
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function locationName(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  const rec = asRecord(value);
  return rec ? scalarString(rec.name) : null;
}

function httpUrl(value: unknown): string | null {
  const s = scalarString(value);
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  return null;
}

function clean(value: string | null): string | null {
  if (!value) return null;
  const t = value.trim();
  return t || null;
}