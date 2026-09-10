import type { SourceSnapshotRecord, SourceChange } from "~/lib/sources/types";

/**
 * Google Search source section (#2181, seam #2218).
 *
 * Renders the latest branded-SERP snapshot inside the seam's SourceSections
 * slot on the competitor detail page: the sponsored advertiser domains, the
 * organic top 10 with per-row position deltas (the same delta wording the
 * public brand page's `GoogleSearchBrandSection` uses), a compact change
 * line off the diff, and a "Last checked" line. Renders nothing when there
 * is no snapshot.
 *
 * The payload shape mirrors `GoogleSerpSnapshotPayload` in
 * `app/lib/sources/google-search/google-serp-snapshot.server.ts`; it is
 * re-declared locally so this client component never imports a `.server.ts`
 * module (the seam's client-bundle guard rejects that). The stored payload
 * is JSON read defensively — `Partial`, `Array.isArray` guards, and per-row
 * narrowing — so a malformed record can never throw here.
 */

interface OrganicRow {
  position: number;
  domain: string;
  title: string;
  url: string;
  prevPosition: number | null;
}

interface SnapshotPayload {
  domain: string;
  query: string;
  provider: string;
  fetchedAt: string;
  sponsoredAdvertisers: string[];
  organic: OrganicRow[];
}

const MAX_ORGANIC_ROWS = 10;

/**
 * Narrow one stored organic row. Only a finite `position` is required —
 * every other field degrades to "" / null so a partially-shaped row still
 * renders instead of dropping the whole list.
 */
function readOrganicRow(raw: unknown): OrganicRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.position !== "number" || !Number.isFinite(r.position)) return null;
  return {
    position: r.position,
    domain: typeof r.domain === "string" ? r.domain : "",
    title: typeof r.title === "string" ? r.title : "",
    url: typeof r.url === "string" ? r.url : "",
    prevPosition:
      typeof r.prevPosition === "number" && Number.isFinite(r.prevPosition)
        ? r.prevPosition
        : null,
  };
}

/** ISO → "d MMM yyyy" (UTC), the same shape the brand-page sections use. */
function formatCheckedDate(iso: string | null | undefined): string {
  if (!iso || typeof iso !== "string") return "";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

const CHANGE_CATEGORIES = new Set(["new_sponsored_advertisers", "new_top10_domains"]);

/**
 * One compact count of the diff entries this section's lists can show:
 * new sponsored advertisers and new top-10 domains since the last check.
 */
function diffChangeCount(diff: SourceChange[]): number {
  let n = 0;
  for (const change of diff) {
    const meta = change?.metadata as { category?: unknown } | null;
    if (meta && typeof meta === "object" && typeof meta.category === "string" &&
        CHANGE_CATEGORIES.has(meta.category)) {
      n += 1;
    }
  }
  return n;
}

/** Only an absolute http(s) url is ever used as a link target. */
function safeHttpUrl(url: string): string | null {
  return /^https?:\/\//i.test(url) ? url : null;
}

export function GoogleSearchSection({
  snapshot,
  diff,
}: {
  snapshot: SourceSnapshotRecord | null;
  diff: SourceChange[];
}) {
  if (!snapshot) return null;
  const payload = snapshot.payload as Partial<SnapshotPayload>;
  const sponsored = Array.isArray(payload.sponsoredAdvertisers)
    ? payload.sponsoredAdvertisers.filter(
        (d): d is string => typeof d === "string" && d.trim() !== "",
      )
    : [];
  const organic = (Array.isArray(payload.organic) ? payload.organic : [])
    .map(readOrganicRow)
    .filter((row): row is OrganicRow => row !== null)
    .slice(0, MAX_ORGANIC_ROWS);
  const checked = formatCheckedDate(payload.fetchedAt ?? snapshot.fetchedAt);

  if (sponsored.length === 0 && organic.length === 0) {
    return (
      <section aria-label="Google Search" className="f9-watchdetail-section">
        <p className="f9-evidence-micro">Google Search</p>
        <p className="f9-wk-dim">No Google results captured for this competitor yet.</p>
        {checked ? <p className="f9-wk-dim">{`Last checked ${checked}`}</p> : null}
      </section>
    );
  }

  const changes = diffChangeCount(diff);
  return (
    <section aria-label="Google Search" className="f9-watchdetail-section">
      <p className="f9-evidence-micro">Google Search</p>
      <h3 className="f9-wk-mt0">Google Search results</h3>
      {sponsored.length > 0 ? (
        <p className="f9-wk-dim">{`Sponsored advertisers: ${sponsored.join(", ")}.`}</p>
      ) : null}
      {organic.length > 0 ? (
        <ol className="f9-quiet-list" data-testid="google-search-organic">
          {organic.map((row) => {
            // Same delta wording as the public brand page: lower position
            // number is a better rank, so position - prevPosition < 0 is "up".
            const delta =
              row.prevPosition != null && row.position != null
                ? row.position - row.prevPosition
                : null;
            const deltaLabel =
              delta == null
                ? ""
                : delta === 0
                  ? " (no change)"
                  : delta < 0
                    ? ` (up ${Math.abs(delta)})`
                    : ` (down ${delta})`;
            const href = safeHttpUrl(row.url);
            const title = row.title || row.domain || row.url || "Untitled result";
            return (
              <li key={`${row.position}:${row.url}`} className="f9-quiet-list-item">
                <span className="f9-quiet-list-copy">
                  {`${row.position}. `}
                  {href ? (
                    <a className="f9-wk-lnk" href={href} target="_blank" rel="noopener noreferrer">
                      {title}
                    </a>
                  ) : (
                    title
                  )}
                  {deltaLabel}
                  {row.domain ? (
                    <span className="f9-wk-dim">{` — ${row.domain}`}</span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}
      {changes > 0 ? (
        <p className="f9-wk-dim">{`${changes} change${changes === 1 ? "" : "s"} since last check`}</p>
      ) : null}
      {checked ? <p className="f9-wk-dim">{`Last checked ${checked}`}</p> : null}
    </section>
  );
}
