import type { SourceSnapshotRecord, SourceChange } from "~/lib/sources/types";

/**
 * Google Ads (Transparency Center) source section (#2189).
 *
 * Renders inside the seam's SourceSections slot on the competitor detail
 * page — never edits the competitor page route (judge batch-2 edit). Shows
 * the advertiser name(s), total creatives, new creatives since last check,
 * the format mix, and up to 12 lazy-loaded image previews. No video embeds.
 * Renders nothing when there is no snapshot.
 *
 * The payload shape mirrors `GoogleAdsSnapshotPayload` in the server module;
 * it is re-declared locally so this client component never imports a
 * `.server.ts` module (the seam's client-bundle guard rejects that).
 */

interface Creative {
  advertiserId: string;
  advertiserName: string;
  creativeId: string;
  format: "text" | "image" | "video" | "unknown";
  domain: string;
  firstShownAt: string | null;
  lastShownAt: string | null;
  previewUrl: string | null;
}

interface SnapshotPayload {
  domain: string;
  fetchedAt: string;
  truncated: boolean;
  creatives: Creative[];
  advertiserCount: number;
  formatMix: { text: number; image: number; video: number; unknown: number };
}

const MAX_PREVIEWS = 12;

function newCreativeCount(diff: SourceChange[]): number {
  for (const change of diff) {
    const meta = change.metadata as { category?: string; creativeIds?: string[] };
    if (meta.category === "new_creatives" && Array.isArray(meta.creativeIds)) {
      return meta.creativeIds.length;
    }
  }
  return 0;
}

export function GoogleAdsSection({
  snapshot,
  diff,
}: {
  snapshot: SourceSnapshotRecord | null;
  diff: SourceChange[];
}) {
  if (!snapshot) return null;
  // The stored payload is JSON written by the adapter; narrow it the same way
  // the other source sections do (Partial, then explicit shape checks) rather
  // than asserting the full shape.
  const payload = snapshot.payload as Partial<SnapshotPayload>;
  const creatives = Array.isArray(payload.creatives) ? payload.creatives : [];
  if (creatives.length === 0) {
    return (
      <section aria-label="Google Ads (Transparency Center)" className="f9-watchdetail-section">
        <p className="f9-evidence-micro">Google Ads (Transparency Center)</p>
        <p className="f9-wk-dim">No Google Ads creatives found for this competitor.</p>
      </section>
    );
  }

  const truncated = payload.truncated === true;
  const advertiserCount =
    typeof payload.advertiserCount === "number" ? payload.advertiserCount : 0;
  const advertiserNames = Array.from(
    new Set(creatives.map((c) => c.advertiserName).filter((n) => n)),
  ).slice(0, 4);
  // Render-time guard: the fetch path already rejects non-https preview
  // URLs, but a stored/malformed payload could still carry javascript:/data:.
  // Only an https URL is ever used as an <img src>.
  const previews = creatives
    .filter(
      (c): c is Creative & { previewUrl: string } =>
        typeof c.previewUrl === "string" && /^https:\/\//i.test(c.previewUrl),
    )
    .slice(0, MAX_PREVIEWS);
  // Guard a malformed/older stored payload: a missing formatMix must not
  // throw and take down the evidence tab.
  const fm = payload.formatMix ?? { text: 0, image: 0, video: 0, unknown: 0 };
  const sinceLast = newCreativeCount(diff);

  return (
    <section aria-label="Google Ads (Transparency Center)" className="f9-watchdetail-section">
      <p className="f9-evidence-micro">Google Ads (Transparency Center)</p>
      <h3 className="f9-wk-mt0">Google Ads creatives</h3>
      <p className="f9-wk-dim">
        {creatives.length} creative{creatives.length === 1 ? "" : "s"}
        {truncated ? " (showing first 200; more exist)" : ""} across {advertiserCount} advertiser
        {advertiserCount === 1 ? "" : "s"}
        {sinceLast > 0 ? ` · ${sinceLast} new since last check` : ""}
      </p>
      {advertiserNames.length > 0 ? (
        <p className="f9-wk-dim">
          {advertiserNames.join(", ")}
          {advertiserCount > advertiserNames.length
            ? ` +${advertiserCount - advertiserNames.length} more`
            : ""}
        </p>
      ) : null}
      <p className="f9-wk-dim">
        Format mix: text {fm.text} · image {fm.image} · video {fm.video}
        {fm.unknown > 0 ? ` · other ${fm.unknown}` : ""}
      </p>
      {previews.length > 0 ? (
        // Reuses the competitor-detail creative wall (the same wall the Meta
        // creatives render in) instead of local inline styles, so the design
        // system owns the grid and no new legacy marker lands.
        <ul className="f9-creative-wall">
          {previews.map((c) => (
            <li key={c.creativeId} className="f9-creative-tile">
              <a
                href={`https://adstransparency.google.com/advertiser/${encodeURIComponent(c.advertiserId)}?creativeId=${encodeURIComponent(c.creativeId)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <img
                  className="f9-ad-thumb"
                  src={c.previewUrl}
                  alt={`Google Ad creative ${c.creativeId} by ${c.advertiserName || "unknown advertiser"}`}
                  loading="lazy"
                />
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
