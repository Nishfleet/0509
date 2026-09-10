import { useState } from "react";
import type { SourceChange, SourceSnapshotRecord } from "~/lib/sources/types";

/**
 * Hiring (job boards) source section (#2199). Renders the latest hiring
 * snapshot: total open roles, opened/closed since the last weekly check,
 * top departments + locations, and a link to the public job board. When no
 * public board has been detected it shows a manual "Job board URL" override
 * that posts to the seam's generic update-source-field action.
 *
 * Client-safe: imports only react + types + local pure helpers. No `.server`
 * modules, no data-layer calls from the render path. Returns null when there
 * is no snapshot (the seam does not pass snapshots to SourceSections yet).
 */

interface OpenJob {
  id: string;
  title: string;
  location: string | null;
  department: string | null;
  url: string | null;
}

interface BoardView {
  kind: "board";
  jobs: OpenJob[];
  provider: string;
  slug: string;
  verified: boolean;
  label: string;
  byDepartment: Record<string, number>;
  byLocation: Record<string, number>;
}

interface NoBoardView {
  kind: "no_board";
  label: string;
}

type HiringView = BoardView | NoBoardView | null;

const EMPTY_COUNTS: Record<string, number> = {};

function parseSnapshot(payload: unknown): HiringView {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (!Array.isArray(p.jobs)) return null;
  const provider = typeof p.provider === "string" && p.provider ? p.provider : null;
  const label = typeof p.label === "string" ? p.label : "this competitor";
  if (p.reason === "no_board" || !provider) {
    return { kind: "no_board", label };
  }
  const jobs: OpenJob[] = (p.jobs as unknown[]).map((raw) => {
    const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    return {
      id: String(r.id ?? ""),
      title: typeof r.title === "string" ? r.title : "",
      location: typeof r.location === "string" ? r.location : null,
      department: typeof r.department === "string" ? r.department : null,
      url: typeof r.url === "string" ? r.url : null,
    };
  });
  const counts =
    p.counts && typeof p.counts === "object"
      ? (p.counts as Record<string, unknown>)
      : {};
  return {
    kind: "board",
    jobs,
    provider,
    slug: typeof p.slug === "string" ? p.slug : "",
    verified: p.verified === true,
    label,
    byDepartment: asCounts(counts.byDepartment),
    byLocation: asCounts(counts.byLocation),
  };
}

function asCounts(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return EMPTY_COUNTS;
  const out: Record<string, number> = {};
  for (const [key, n] of Object.entries(value as Record<string, unknown>)) {
    if (typeof n === "number") out[key] = n;
  }
  return out;
}

/** Public board link per provider. */
function boardUrlFor(provider: string, slug: string): string {
  switch (provider) {
    case "greenhouse":
      return `https://boards.greenhouse.io/${slug}`;
    case "ashby":
      return `https://jobs.ashbyhq.com/${slug}`;
    case "lever":
      return `https://jobs.lever.co/${slug}`;
    default:
      return "";
  }
}

/* --------------------------- manual override --------------------------- */

interface ManualBoard {
  provider: string;
  slug: string;
}

/**
 * Parse a typed board URL into {provider, slug}. Greenhouse accepts
 * boards.greenhouse.io/<slug>, job-boards.greenhouse.io/<slug>, or a
 * <slug>.greenhouse.io subdomain; Ashby and Lever are their jobs.* hosts.
 * A scheme is optional (a bare `acme.greenhouse.io` is accepted).
 * Unrecognized input returns null.
 */
export function parseBoardUrl(raw: string): ManualBoard | null {
  const s = raw.trim();
  if (!s) return null;
  let hostname: string;
  let pathname = "/";
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
    hostname = u.hostname.toLowerCase();
    pathname = u.pathname;
  } catch {
    return null;
  }
  const seg = pathname.match(/^\/?([a-z0-9_-]+)\/?$/i)?.[1];
  if (hostname === "boards.greenhouse.io" || hostname === "job-boards.greenhouse.io") {
    return seg ? { provider: "greenhouse", slug: seg } : null;
  }
  if (hostname === "jobs.ashbyhq.com") {
    return seg ? { provider: "ashby", slug: seg } : null;
  }
  if (hostname === "jobs.lever.co") {
    return seg ? { provider: "lever", slug: seg } : null;
  }
  const subdomain = hostname.match(/^([a-z0-9_-]+)\.greenhouse\.io$/i);
  return subdomain ? { provider: "greenhouse", slug: subdomain[1] } : null;
}

/** Watchlist id from `/app/watchlists/<id>/...`. */
function watchlistIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/app\/watchlists\/([^/?]+)/);
  return m ? m[1] : null;
}

async function submitBoardOverride(
  parsed: ManualBoard,
): Promise<{ ok: boolean }> {
  if (typeof window === "undefined") return { ok: false };
  const id = watchlistIdFromPath(window.location.pathname);
  if (!id) return { ok: false };
  const origin = window.location.origin;
  const post = (field: string, value: string) => {
    const form = new FormData();
    form.set("intent", "update-source-field");
    form.set("sourceId", "hiring");
    form.set("field", field);
    form.set("value", value);
    return fetch(`${origin}/app/watchlists/${id}`, { method: "POST", body: form });
  };
  try {
    const [slugRes, providerRes, verifiedRes] = await Promise.all([
      post("job_board_slug", parsed.slug),
      post("job_board_provider", parsed.provider),
      post("job_board_verified", "1"),
    ]);
    return { ok: slugRes.ok && providerRes.ok && verifiedRes.ok };
  } catch {
    return { ok: false };
  }
}

/* --------------------------- diff line --------------------------- */

function numberFrom(md: Record<string, unknown>, key: string): number | undefined {
  const v = md[key];
  return typeof v === "number" ? v : undefined;
}

/**
 * N opened / M closed from the diff. Phase 5 emits exactly ONE grouped
 * `role_change` change per check carrying both counts; earlier per-side
 * shapes are not read (the section only ever sees the grouped one).
 */
function roleChanges(diff: SourceChange[]): { opened?: number; closed?: number } {
  for (const c of diff) {
    const md = c.metadata;
    if (!md || typeof md !== "object") continue;
    const m = md as Record<string, unknown>;
    if (m.kind !== "role_change") continue;
    return { opened: numberFrom(m, "opened"), closed: numberFrom(m, "closed") };
  }
  return {};
}

/** Top `limit` entries of a count map, sorted desc by count then asc by key. */
function topEntries(counts: Record<string, number>, limit: number): string[] {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([group, count]) => `${group}: ${count}`);
}

export function HiringSection({
  snapshot,
  diff,
}: {
  snapshot: SourceSnapshotRecord | null;
  diff: SourceChange[];
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const view = parseSnapshot(snapshot?.payload);
  if (!view) return null;

  if (view.kind === "board") {
    const { opened, closed } = roleChanges(diff);
    const changeLine =
      opened !== undefined && closed !== undefined
        ? `${opened} opened / ${closed} closed since last check`
        : opened !== undefined
          ? `${opened} opened since last check`
          : closed !== undefined
            ? `${closed} closed since last check`
            : null;
    const depts = topEntries(view.byDepartment, 3);
    const locs = topEntries(view.byLocation, 3);
    const href = boardUrlFor(view.provider, view.slug);
    return (
      <section aria-label="Hiring">
        <p className="f9-evidence-micro">Hiring</p>
        <p className="f9-wk-dim">
          {view.jobs.length} open role{view.jobs.length === 1 ? "" : "s"}
          {view.verified !== true ? " · unconfirmed board" : ""}
        </p>
        {changeLine ? <p className="f9-wk-dim">{changeLine}</p> : null}
        {depts.length > 0 ? (
          <p className="f9-wk-dim">Top departments: {depts.join(" · ")}</p>
        ) : null}
        {locs.length > 0 ? (
          <p className="f9-wk-dim">Top locations: {locs.join(" · ")}</p>
        ) : null}
        {href ? (
          <p>
            <a className="f9-wk-lnk" href={href} rel="noopener noreferrer" target="_blank">
              View job board
            </a>
          </p>
        ) : null}
      </section>
    );
  }

  // No public board detected — render the manual override field.
  return (
    <section aria-label="Hiring">
      <p className="f9-evidence-micro">Hiring</p>
      <p className="f9-wk-dim">No public job board detected</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = parseBoardUrl(url);
          if (!parsed) {
            setError("We don't recognize that as a Greenhouse, Ashby, or Lever board URL.");
            return;
          }
          setError(null);
          void submitBoardOverride(parsed).then((result) => {
            if (result.ok) setConfirmed(true);
            else setError("Could not save the board. Please try again.");
          });
        }}
      >
        <div className="f9-field">
          <span>Job board URL</span>
          <input
            type="url"
            value={url}
            onChange={(event) => setUrl(event.currentTarget.value)}
            placeholder="https://boards.greenhouse.io/acme"
            aria-label="Job board URL"
          />
        </div>
        {error ? <p className="f9-wk-note">{error}</p> : null}
        {confirmed ? <p className="f9-wk-note">Board confirmed — saved.</p> : null}
        <button type="submit" className="f9-wk-btn">
          Save
        </button>
      </form>
    </section>
  );
}