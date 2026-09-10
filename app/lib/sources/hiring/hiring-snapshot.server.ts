import type { AppEnv } from "~/lib/env.server";
import { ensureDb } from "~/lib/data/d1.server";
import { nowIso, type JsonRecord } from "~/lib/data/helpers.server";
import { registrableDomainFromHostname } from "~/lib/search-query";
import { getLatestSourceSnapshot } from "~/lib/sources/run.server";
import type {
  SourceChange,
  SourceFetchContext,
  SourceFetchResult,
  SourceSnapshotInput,
  SourceSnapshotRecord,
} from "~/lib/sources/types";
import {
  fetchJobs,
  type FetchFn,
  type HiringCounts,
  type HiringJob,
} from "~/lib/sources/hiring/hiring-signals.server";
import {
  discoverJobBoard,
  JOB_BOARD_PROVIDERS,
  type JobBoardProvider,
} from "~/lib/sources/hiring/job-board-discovery.server";

/**
 * Hiring weekly snapshot + diff (#2199).
 *
 * Weekly cadence is the per-competitor 7-day gate against the latest stored
 * `source_snapshot` row (consumed from run.server's `getLatestSourceSnapshot`),
 * exactly like tiktok-ads. No new scheduler.
 *
 * Flow per competitor per run that passes the gate:
 *  1. Read the stored `job_board_provider/slug/verified` from `watchlist`.
 *  2. A stored board is fetched (phase 3). If it 404s (`not_found`), re-run
 *     discovery (phase 2) to recover a new board.
 *  3. No stored board -> run discovery. A discovered board is persisted via
 *     `competitorUpdate` and then fetched. `board: null` (site fetched, no
 *     board) returns a real no-board snapshot so the Section can show
 *     "No public job board detected" — an `unavailable: true` would hide it.
 *     Discovery that is itself unavailable (network down) returns that
 *     unavailable.
 */
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const defaultFetch: FetchFn = (url, init) => globalThis.fetch(url, init);

interface WatchlistRow {
  target_id: string | null;
  job_board_provider: string | null;
  job_board_slug: string | null;
  job_board_verified: number | null;
}

interface StoredBoard {
  provider: JobBoardProvider;
  slug: string;
  verified: boolean;
}

/** Successful `fetchJobs` outcome, minus the unavailable variant. */
interface BoardResult {
  provider: JobBoardProvider;
  slug: string;
  fetchedAt: string;
  jobs: HiringJob[];
  counts: HiringCounts;
}

export async function fetchHiringSnapshot(
  env: unknown,
  competitor: SourceFetchContext,
): Promise<SourceFetchResult> {
  const appEnv = env as AppEnv;

  // 7-day gate: skip when the latest snapshot is less than 7 days old.
  const latest = await getLatestSourceSnapshot(
    appEnv,
    competitor.competitorId,
    "hiring",
  );
  if (latest) {
    const fetchedAtMs = Date.parse(latest.fetchedAt);
    if (Number.isFinite(fetchedAtMs) && Date.now() - fetchedAtMs < SEVEN_DAYS_MS) {
      return { unavailable: true, reason: "cadence" };
    }
  }

  const row = await loadWatchlistRow(appEnv, competitor.competitorId);
  const stored = parseStoredBoard(row);

  if (stored) {
    const fetched = await fetchJobs(
      { provider: stored.provider, slug: stored.slug },
      defaultFetch,
    );
    if (fetched.unavailable) {
      // A stored board that 404s is gone -> recover via discovery.
      if (fetched.reason === "not_found") {
        return discoverThenFetch(appEnv, competitor, row);
      }
      return fetched;
    }
    return buildBoardResult(fetched, stored.verified, competitor, latest);
  }

  return discoverThenFetch(appEnv, competitor, row);
}

/** Run discovery (phase 2), persist if found, then fetch the board (phase 3). */
async function discoverThenFetch(
  appEnv: AppEnv,
  competitor: SourceFetchContext,
  row: WatchlistRow | null,
): Promise<SourceFetchResult> {
  const domain = domainFromTargetId(row?.target_id);
  if (!domain) {
    // No derivable homepage domain -> cannot probe; honest no-board snapshot.
    return noBoardResult(competitor.competitorLabel);
  }
  const discovery = await discoverJobBoard(appEnv, competitor, { domain });
  if ("unavailable" in discovery) {
    // Network/timeout during discovery: surface the unavailable.
    return discovery;
  }
  // A `{ board: null }` result (has a `board` key) means the site fetched
  // fine but no board was found -> real no-board snapshot.
  if ("board" in discovery) {
    return noBoardResult(competitor.competitorLabel);
  }

  const fetched = await fetchJobs(
    { provider: discovery.provider, slug: discovery.slug },
    defaultFetch,
  );
  if (fetched.unavailable) {
    // Fresh discovery that falls over on its own feed: leave the board
    // unpersisted so it is re-discovered on a later check, and surface the
    // unavailable rather than storing a phantom.
    return fetched;
  }
  const discoveredAt = nowIso();
  return boardResultWithDiscover(fetched, discovery.verified, discoveredAt, competitor);
}

/* --------------------------- result builders --------------------------- */

function buildBoardResult(
  fetched: BoardResult,
  verified: boolean,
  competitor: SourceFetchContext,
  latest: SourceSnapshotRecord | null,
): SourceSnapshotInput {
  const discoveredAt = readDiscoveredAt(latest);
  return boardResult(fetched, verified, discoveredAt, competitor);
}

function boardResultWithDiscover(
  fetched: BoardResult,
  verified: boolean,
  discoveredAt: string,
  competitor: SourceFetchContext,
): SourceSnapshotInput {
  return boardResult(fetched, verified, discoveredAt, competitor);
}

function boardResult(
  fetched: BoardResult,
  verified: boolean,
  discoveredAt: string | undefined,
  competitor: SourceFetchContext,
): SourceSnapshotInput {
  const payload: JsonRecord = {
    jobs: fetched.jobs,
    provider: fetched.provider,
    slug: fetched.slug,
    verified,
    label: competitor.competitorLabel,
    counts: fetched.counts,
    fetchedAt: fetched.fetchedAt,
  };
  if (discoveredAt) {
    payload.discoveredAt = discoveredAt;
  }
  return {
    payload,
    competitorUpdate: {
      job_board_provider: fetched.provider,
      job_board_slug: fetched.slug,
      job_board_verified: verified ? 1 : 0,
    },
  };
}

function noBoardResult(label: string): SourceSnapshotInput {
  return {
    payload: {
      jobs: [],
      provider: null,
      slug: null,
      verified: null,
      board: null,
      reason: "no_board",
      label,
      counts: { byDepartment: {}, byLocation: {} },
      fetchedAt: nowIso(),
    },
  };
}

/* --------------------------- phase 5: diff --------------------------- */

interface HiringPayload {
  jobs: HiringJob[];
  provider: string | null;
  verified: boolean | null;
  label: string | undefined;
}

function toHiringPayload(payload: JsonRecord): HiringPayload | null {
  if (!payload || typeof payload !== "object") return null;
  if (!Array.isArray(payload.jobs)) return null;
  const jobs: HiringJob[] = (payload.jobs as unknown[])
    .map((raw) => raw && typeof raw === "object" ? raw as Record<string, unknown> : null)
    .filter((r): r is Record<string, unknown> => Boolean(r))
    .map((r) => ({
      id: String(r.id ?? ""),
      title: typeof r.title === "string" ? r.title : "",
      location: typeof r.location === "string" ? r.location : null,
      department: typeof r.department === "string" ? r.department : null,
      url: typeof r.url === "string" ? r.url : null,
      postedAt: typeof r.postedAt === "string" ? r.postedAt : null,
    }));
  return {
    jobs,
    provider: typeof payload.provider === "string" ? payload.provider : null,
    verified: typeof payload.verified === "boolean" ? payload.verified : null,
    label: typeof payload.label === "string" ? payload.label : undefined,
  };
}

/**
 * The adapter's diff body. New ids (in next, not in prev) are `opened`;
 * missing ids (in prev, not in next) are `closed`. Emits exactly ONE grouped
 * `role_change` SourceChange per check when N >= 1 opened OR M >= 5 closed;
 * never one event per job id.
 *
 * Never alerts when:
 *  - no board is known (jobs empty + provider null);
 *  - the board is an unconfirmed guess (`verified === false`);
 *  - prev is null / unparseable (baseline).
 */
export function diffHiring(
  prev: SourceSnapshotRecord | null,
  next: SourceSnapshotInput,
): SourceChange[] {
  const nextHiring = toHiringPayload(next.payload);
  if (!nextHiring) return [];

  // No board -> no alerts.
  if (nextHiring.jobs.length === 0 && !nextHiring.provider) return [];
  // Unconfirmed (label-guessed) board must never alert until manually verified.
  if (nextHiring.verified === false) return [];

  const prevHiring = prev ? toHiringPayload(prev.payload) : null;
  if (!prevHiring) return []; // baseline never alerts

  const prevIds = new Set<string>(prevHiring.jobs.map((j) => j.id));
  const nextIds = new Set<string>(nextHiring.jobs.map((j) => j.id));
  const opened = nextHiring.jobs.filter((j) => !prevIds.has(j.id));
  const closed = prevHiring.jobs.filter((j) => !nextIds.has(j.id));
  const N = opened.length;
  const M = closed.length;
  if (N < 1 && M < 5) return [];

  const label = nextHiring.label ?? "this company";
  return [
    {
      eventType: "website_page_changed",
      title: `Hiring changed at ${label} · ${N} opened / ${M} closed`,
      summary: roleChangeSummary(N, M, opened, closed),
      metadata: {
        kind: "role_change",
        opened: N,
        closed: M,
        openedJobIds: opened.map((j) => j.id),
        closedJobIds: closed.map((j) => j.id),
        openedTopDepartments: topEntries(opened, "department", 3),
        openedTopLocations: topEntries(opened, "location", 3),
        closedTopDepartments: topEntries(closed, "department", 3),
        closedTopLocations: topEntries(closed, "location", 3),
      },
    },
  ];
}

/** Counts plus the top departments/locations for both sides of one check. */
function roleChangeSummary(
  N: number,
  M: number,
  opened: HiringJob[],
  closed: HiringJob[],
): string {
  const parts = [
    `${N} role${N === 1 ? "" : "s"} opened and ${M} role${M === 1 ? "" : "s"} closed since the last weekly check.`,
  ];
  const openedDepts = topEntriesText(opened, "department", 3);
  const openedLocs = topEntriesText(opened, "location", 3);
  const closedDepts = topEntriesText(closed, "department", 3);
  const closedLocs = topEntriesText(closed, "location", 3);
  if (openedDepts) parts.push(`Opened — top departments: ${openedDepts}.`);
  if (openedLocs) parts.push(`Opened — top locations: ${openedLocs}.`);
  if (closedDepts) parts.push(`Closed — top departments: ${closedDepts}.`);
  if (closedLocs) parts.push(`Closed — top locations: ${closedLocs}.`);
  return parts.join(" ");
}

function topEntriesText(
  jobs: HiringJob[],
  field: "department" | "location",
  limit: number,
): string {
  return topEntries(jobs, field, limit)
    .map((e) => `${e.group} (${e.count})`)
    .join(", ");
}

function topEntries(
  jobs: HiringJob[],
  field: "department" | "location",
  limit: number,
): Array<{ group: string; count: number }> {
  const counts = new Map<string, number>();
  for (const job of jobs) {
    const raw = field === "department" ? job.department : job.location;
    const group = raw && raw.trim() ? raw.trim() : field === "department" ? "(none)" : "(remote)";
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([group, count]) => ({ group, count }));
}

/* --------------------------- helpers --------------------------- */

function readDiscoveredAt(latest: SourceSnapshotRecord | null): string | undefined {
  if (latest?.payload && typeof latest.payload.discoveredAt === "string") {
    return latest.payload.discoveredAt;
  }
  return undefined;
}

function parseStoredBoard(row: WatchlistRow | null): StoredBoard | null {
  if (!row) return null;
  const provider = row.job_board_provider as JobBoardProvider | null;
  if (!provider || !JOB_BOARD_PROVIDERS.includes(provider)) return null;
  const slug = row.job_board_slug?.trim();
  if (!slug) return null;
  return { provider, slug, verified: row.job_board_verified === 1 };
}

async function loadWatchlistRow(
  env: AppEnv,
  competitorId: string,
): Promise<WatchlistRow | null> {
  const row = await ensureDb(env)
    .prepare(
      `SELECT target_id, job_board_provider, job_board_slug, job_board_verified
       FROM watchlist WHERE id = ?`,
    )
    .bind(competitorId)
    .first<WatchlistRow>();
  return row ?? null;
}

/** Derive the competitor's public host from the watchlist `target_id` URL. */
function domainFromTargetId(targetId: string | null | undefined): string | null {
  if (!targetId) return null;
  const raw = targetId.trim();
  if (!raw) return null;
  let hostname: string;
  try {
    hostname = new URL(raw).hostname;
  } catch {
    try {
      hostname = new URL(`https://${raw}`).hostname;
    } catch {
      return null;
    }
  }
  hostname = hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  if (!hostname || !registrableDomainFromHostname(hostname)) return null;
  return hostname;
}