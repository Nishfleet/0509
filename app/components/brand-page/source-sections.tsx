/**
 * Public brand-page source sections (issue #2200).
 *
 * Renders the new competitor-monitoring sources on the public /ads/:domain
 * page, after the existing Meta block, in the issue's fixed order:
 *   1. Google Ads inventory
 *   2. Google Search
 *   3. LinkedIn ads
 *   4. TikTok ads
 *   5. New web addresses
 *   6. Hiring
 *
 * Each section: an h2 with a STABLE id anchor, one factual sentence, the
 * data, and a "last checked <date>" line in the BODY only (never in the
 * title, description, or canonical — issue #1522). A section renders only
 * when its snapshot exists; missing sources are omitted entirely (no
 * placeholder). The order is fixed regardless of which sources landed.
 *
 * These components are client-safe: they import only types and the
 * BrandPageSourceSnapshot shape, never a `.server.ts` adapter module. They
 * re-declare the payload shapes they read so the client bundle never pulls
 * in the server-only snapshot modules.
 */
import type { SourceId, SourceSnapshotRecord } from "~/lib/sources/types";
import type { BrandPageSourceSnapshot } from "~/components/brand-page/source-snapshots.server";

/** ISO → "d MMM yyyy" (UTC), the same shape the offer timeline uses. */
function formatCheckedDate(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** The shared section shell — matches the ads-page `f9-ads-sec` design. */
function BrandPageSourceSection({
  anchorId,
  eyebrow,
  title,
  children,
  checkedAt,
  checkedLabel,
}: {
  anchorId: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
  checkedAt: string | null;
  checkedLabel: string;
}) {
  const checked = formatCheckedDate(checkedAt);
  return (
    <section className="f9-ads-sec" aria-labelledby={`${anchorId}-title`}>
      <div className="f9-container">
        <div className="f9-ads-sec-head">
          <div className="f9-ads-sec-head-left">
            <span className="f9-ads-sec-eyebrow">{eyebrow}</span>
            <h2 id={`${anchorId}-title`}>{title}</h2>
          </div>
        </div>
        {children}
        {checked ? (
          <p className="f9-wk-dim" data-testid={`${anchorId}-checked`}>
            {`${checkedLabel} ${checked}`}
          </p>
        ) : null}
      </div>
    </section>
  );
}

// --- Google Ads (Transparency Center) ----------------------------------

interface GoogleAdsCreative {
  advertiserId: string;
  advertiserName: string;
  creativeId: string;
  format: "text" | "image" | "video" | "unknown";
  domain: string;
  firstShownAt: string | null;
  lastShownAt: string | null;
  previewUrl: string | null;
}
interface GoogleAdsPayload {
  domain: string;
  fetchedAt: string;
  truncated: boolean;
  creatives: GoogleAdsCreative[];
  advertiserCount: number;
  formatMix: { text: number; image: number; video: number; unknown: number };
}

const GOOGLE_ADS_MAX_PREVIEWS = 12;

function GoogleAdsBrandSection({ snapshot }: { snapshot: SourceSnapshotRecord }) {
  const payload = snapshot.payload as Partial<GoogleAdsPayload>;
  const creatives = Array.isArray(payload.creatives) ? payload.creatives : [];
  if (creatives.length === 0) return null;
  const advertiserCount =
    typeof payload.advertiserCount === "number" ? payload.advertiserCount : 0;
  const advertiserNames = Array.from(
    new Set(creatives.map((c) => c.advertiserName).filter(Boolean)),
  ).slice(0, 4);
  const fm = payload.formatMix ?? { text: 0, image: 0, video: 0, unknown: 0 };
  const previews = creatives
    .filter(
      (c): c is GoogleAdsCreative & { previewUrl: string } =>
        typeof c.previewUrl === "string" && /^https:\/\//i.test(c.previewUrl),
    )
    .slice(0, GOOGLE_ADS_MAX_PREVIEWS);
  const truncated = payload.truncated === true;
  return (
    <BrandPageSourceSection
      anchorId="brand-google-ads"
      eyebrow="Google Ads (Transparency Center)"
      title="Google Ads inventory"
      checkedAt={payload.fetchedAt ?? snapshot.fetchedAt}
      checkedLabel="Last checked"
    >
      <p className="f9-wk-dim">
        {`${creatives.length} creative${creatives.length === 1 ? "" : "s"}${truncated ? " (showing first 200; more exist)" : ""} across ${advertiserCount} advertiser${advertiserCount === 1 ? "" : "s"} for ${payload.domain ?? "this brand"}.`}
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
        {`Format mix: text ${fm.text} · image ${fm.image} · video ${fm.video}${fm.unknown > 0 ? ` · other ${fm.unknown}` : ""}.`}
      </p>
      {previews.length > 0 ? (
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
    </BrandPageSourceSection>
  );
}

// --- Google Search -----------------------------------------------------

interface GoogleSearchPayload {
  domain: string;
  fetchedAt: string;
  sponsoredAdvertisers: string[];
  organic: Array<{ position: number; url: string; title: string; prevPosition: number | null }>;
}

function GoogleSearchBrandSection({ snapshot }: { snapshot: SourceSnapshotRecord }) {
  const payload = snapshot.payload as Partial<GoogleSearchPayload>;
  const sponsored = Array.isArray(payload.sponsoredAdvertisers)
    ? payload.sponsoredAdvertisers
    : [];
  const organic = Array.isArray(payload.organic) ? payload.organic : [];
  if (sponsored.length === 0 && organic.length === 0) return null;
  return (
    <BrandPageSourceSection
      anchorId="brand-google-search"
      eyebrow="Google Search"
      title="Google Search results"
      checkedAt={payload.fetchedAt ?? snapshot.fetchedAt}
      checkedLabel="Last checked"
    >
      {sponsored.length > 0 ? (
        <p className="f9-wk-dim">
          {`Sponsored advertisers: ${sponsored.join(", ")}.`}
        </p>
      ) : null}
      {organic.length > 0 ? (
        <ol className="f9-quiet-list" data-testid="brand-google-search-organic">
          {organic.slice(0, 10).map((row) => {
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
            return (
              <li key={`${row.position}:${row.url}`} className="f9-quiet-list-item">
                <span className="f9-quiet-list-copy">
                  {`${row.position}. ${row.title}${deltaLabel}`}
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}
    </BrandPageSourceSection>
  );
}

// --- LinkedIn ads ------------------------------------------------------

interface LinkedinAdsPayload {
  totalAds: number;
  fetchedAt: string;
  ads: Array<{ adId: string; firstSeen: string | null; lastSeen: string | null }>;
}

function LinkedinAdsBrandSection({ snapshot }: { snapshot: SourceSnapshotRecord }) {
  const payload = snapshot.payload as Partial<LinkedinAdsPayload>;
  const ads = Array.isArray(payload.ads) ? payload.ads : [];
  const total = typeof payload.totalAds === "number" ? payload.totalAds : ads.length;
  if (total === 0 && ads.length === 0) return null;
  return (
    <BrandPageSourceSection
      anchorId="brand-linkedin-ads"
      eyebrow="LinkedIn Ads"
      title="LinkedIn ads"
      checkedAt={payload.fetchedAt ?? snapshot.fetchedAt}
      checkedLabel="Last checked"
    >
      <p className="f9-wk-dim">
        {`${total} LinkedIn ad${total === 1 ? "" : "s"} on record.`}
      </p>
      {ads.length > 0 ? (
        <ul className="f9-quiet-list" data-testid="brand-linkedin-ads-list">
          {ads.slice(0, 6).map((ad) => (
            <li key={ad.adId} className="f9-quiet-list-item">
              <span className="f9-quiet-list-copy">
                {ad.firstSeen ? `First seen ${formatCheckedDate(ad.firstSeen)}` : "Newest ad"}
                {ad.lastSeen ? ` · last seen ${formatCheckedDate(ad.lastSeen)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </BrandPageSourceSection>
  );
}

// --- TikTok ads --------------------------------------------------------

interface TiktokAdView {
  adId: string;
  advertiser: string;
  firstShown: string;
  lastShown: string;
  uniqueUsers: string;
  thumbnail: string | null;
}
interface TiktokPayloadView {
  ads: TiktokAdView[];
  totalAds: number;
  legalName: string;
  fetchedAt?: string;
}

function TiktokAdsBrandSection({ snapshot }: { snapshot: SourceSnapshotRecord }) {
  const payload = snapshot.payload as Partial<TiktokPayloadView>;
  if (!Array.isArray(payload.ads) || typeof payload.totalAds !== "number") return null;
  const ads = payload.ads;
  const totalAds = payload.totalAds;
  const legalName = payload.legalName ?? "";
  return (
    <BrandPageSourceSection
      anchorId="brand-tiktok-ads"
      eyebrow="TikTok ads — EU-shown only"
      title="TikTok ads"
      checkedAt={payload.fetchedAt ?? snapshot.fetchedAt}
      checkedLabel="Last checked"
    >
      <p className="f9-wk-dim">
        {legalName
          ? `Advertiser: ${legalName} · Total EU-shown ads: ${totalAds}.`
          : `Total EU-shown ads: ${totalAds}.`}
      </p>
      {ads.length > 0 ? (
        <ul className="f9-quiet-list" data-testid="brand-tiktok-ads-list">
          {ads.slice(0, 6).map((ad) => (
            <li key={ad.adId} className="f9-quiet-list-item">
              <span className="f9-quiet-list-copy">
                <a
                  className="f9-wk-lnk"
                  href={`https://library.tiktok.com/ads/detail/?ad_id=${ad.adId}`}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  View ad
                </a>
                {` · first shown ${ad.firstShown} · last shown ${ad.lastShown}`}
                {ad.uniqueUsers ? ` · ${ad.uniqueUsers} unique users` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="f9-wk-dim">No EU-shown TikTok ads found.</p>
      )}
      <p className="f9-wk-dim">
        EU-shown ads only. TikTok's Commercial Content Library does not expose spend or impressions.
      </p>
    </BrandPageSourceSection>
  );
}

// --- New web addresses (subdomains) ------------------------------------

interface SubdomainNameEntry {
  name: string;
  kind: "public" | "internal";
  firstSeen: string | null;
}
interface SubdomainSnapshotPayloadView {
  domain: string;
  names: SubdomainNameEntry[];
  truncated: boolean;
}

function SubdomainsBrandSection({ snapshot }: { snapshot: SourceSnapshotRecord }) {
  const payload = snapshot.payload as Partial<SubdomainSnapshotPayloadView>;
  if (typeof payload.domain !== "string" || !Array.isArray(payload.names)) return null;
  const publicNames = payload.names.filter((n) => n.kind === "public");
  if (publicNames.length === 0) return null;
  const newest = publicNames.slice(0, 5);
  return (
    <BrandPageSourceSection
      anchorId="brand-subdomains"
      eyebrow="New web addresses"
      title="New web addresses"
      checkedAt={snapshot.fetchedAt}
      checkedLabel="Last checked"
    >
      <p className="f9-wk-dim">
        {`${publicNames.length} public address${publicNames.length === 1 ? "" : "es"} seen in Certificate Transparency logs for ${payload.domain}. A new address often means a new product surface is being built.`}
      </p>
      <ul className="f9-quiet-list" data-testid="brand-subdomains-list">
        {newest.map((entry) => (
          <li key={entry.name} className="f9-quiet-list-item">
            <span className="f9-quiet-list-copy">
              {entry.name}
              {entry.firstSeen ? ` · first seen ${formatCheckedDate(entry.firstSeen)}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </BrandPageSourceSection>
  );
}

// --- Hiring ------------------------------------------------------------

interface HiringPayload {
  domain: string;
  fetchedAt: string;
  openRoles: number;
  departments: string[];
  locations: string[];
}

function HiringBrandSection({ snapshot }: { snapshot: SourceSnapshotRecord }) {
  const payload = snapshot.payload as Partial<HiringPayload>;
  const openRoles = typeof payload.openRoles === "number" ? payload.openRoles : 0;
  const departments = Array.isArray(payload.departments) ? payload.departments : [];
  const locations = Array.isArray(payload.locations) ? payload.locations : [];
  if (openRoles === 0 && departments.length === 0 && locations.length === 0) return null;
  return (
    <BrandPageSourceSection
      anchorId="brand-hiring"
      eyebrow="Hiring"
      title="Hiring"
      checkedAt={payload.fetchedAt ?? snapshot.fetchedAt}
      checkedLabel="Last checked"
    >
      <p className="f9-wk-dim">
        {`${openRoles} open role${openRoles === 1 ? "" : "s"} on record.`}
      </p>
      {departments.length > 0 ? (
        <p className="f9-wk-dim">
          {`Top departments: ${departments.slice(0, 5).join(", ")}.`}
        </p>
      ) : null}
      {locations.length > 0 ? (
        <p className="f9-wk-dim">
          {`Top locations: ${locations.slice(0, 5).join(", ")}.`}
        </p>
      ) : null}
    </BrandPageSourceSection>
  );
}

// --- Ordered registry of public section renderers ----------------------

/**
 * The fixed render order (issue #2200 step 2). Each entry maps a source id
 * to its public section component. A source not in this map never renders
 * on the public page even if a snapshot exists.
 */
const SECTION_RENDERERS: Array<{
  sourceId: SourceId;
  render: (snapshot: SourceSnapshotRecord) => React.ReactNode;
}> = [
  { sourceId: "google_ads", render: (s) => <GoogleAdsBrandSection snapshot={s} /> },
  { sourceId: "google", render: (s) => <GoogleSearchBrandSection snapshot={s} /> },
  { sourceId: "linkedin", render: (s) => <LinkedinAdsBrandSection snapshot={s} /> },
  { sourceId: "tiktok", render: (s) => <TiktokAdsBrandSection snapshot={s} /> },
  { sourceId: "subdomains", render: (s) => <SubdomainsBrandSection snapshot={s} /> },
  { sourceId: "hiring", render: (s) => <HiringBrandSection snapshot={s} /> },
];

export interface BrandPageSourceSectionsProps {
  /**
   * Snapshots for live sources that have data, in any order. Optional and
   * null-tolerant on purpose: this renders on a public SEO page, so a data
   * shape that predates this field (or any caller that omits it) must
   * degrade to "no sections", never throw and 500 the page.
   */
  snapshots?: BrandPageSourceSnapshot[] | null;
}

/**
 * Render the source sections in the issue's fixed order. A section renders
 * only when its snapshot exists AND its renderer returns content (some
 * renderers return null for an empty payload — the section omits). The
 * whole block renders nothing when no live source has a snapshot.
 */
export function BrandPageSourceSections({ snapshots }: BrandPageSourceSectionsProps) {
  if (!snapshots || snapshots.length === 0) return null;
  const byId = new Map(snapshots.map((s) => [s.sourceId, s.snapshot]));
  const nodes: React.ReactNode[] = [];
  for (const entry of SECTION_RENDERERS) {
    const snapshot = byId.get(entry.sourceId);
    if (!snapshot) continue;
    const node = entry.render(snapshot);
    if (node != null) nodes.push(node);
  }
  if (nodes.length === 0) return null;
  return <>{nodes}</>;
}
