import type { ComponentType } from "react";

import { GoogleSearchSection } from "~/components/sources/google-search";
import { GoogleAdsSection } from "~/components/sources/google-ads";
import { LinkedinAdsSection } from "~/components/sources/linkedin-ads";
import { TiktokAdsSection } from "~/components/sources/tiktok-ads";
import { SubdomainsSection } from "~/components/sources/subdomains";
import { HiringSection } from "~/components/sources/hiring";
import { getPlanEntitlements, type PlanFamily } from "~/lib/plan-entitlements";
import type { SourceChange, SourceId, SourceSnapshotRecord } from "~/lib/sources/types";

/**
 * Renders the enabled source adapter sections for a competitor. The seam
 * (#2218) inserts this once after the existing Meta block on the competitor
 * detail page. Each adapter's `Section` component receives its latest
 * snapshot and diff. Stub sections render nothing, so on main no new
 * sections appear.
 *
 * `snapshots` is an optional map of sourceId → { snapshot, diff }. When
 * absent (no source data loaded yet), every section receives null/empty
 * and stubs render nothing.
 *
 * `plan` drives the locked-source lines (#2212 do:3): when the plan's
 * `sources` entitlement is an allowlist (added by #2212 in plan.server.ts),
 * every source NOT in that list renders one locked line here. Until #2212
 * adds the field it is absent → "all sources" → no locked lines, so the seam
 * on main renders nothing extra.
 *
 * This component is client-safe: it imports only the Section `.tsx`
 * components and the static labels, never the `.server.ts` adapter modules.
 * The server-side registry (`registry.server.ts`) owns the adapter array
 * with `fetch`/`diff`/`requiresEnv`; this map mirrors only the rendering
 * surface (id, label, Section component).
 */

export interface SourceSectionsProps {
  competitorId: string;
  snapshots?: Record<string, { snapshot: SourceSnapshotRecord | null; diff: SourceChange[] }>;
  /** The competitor owner's plan family; drives plan-locked source lines. */
  plan?: PlanFamily;
}

interface SourceSectionEntry {
  id: SourceId;
  label: string;
  Section: ComponentType<{ snapshot: SourceSnapshotRecord | null; diff: SourceChange[] }>;
}

/**
 * Client-side source section entries — one per registered source. Labels
 * mirror the adapter labels in the `.server.ts` stubs; the source tickets
 * that replace the stubs keep the same labels.
 */
const SOURCE_SECTION_ENTRIES: readonly SourceSectionEntry[] = [
  { id: "google", label: "Google Search", Section: GoogleSearchSection },
  { id: "google_ads", label: "Google Ads (Transparency Center)", Section: GoogleAdsSection },
  { id: "linkedin", label: "LinkedIn Ads (Ad Library)", Section: LinkedinAdsSection },
  { id: "tiktok", label: "TikTok Ads (Commercial Content Library, EU-shown)", Section: TiktokAdsSection },
  { id: "subdomains", label: "New web addresses", Section: SubdomainsSection },
  { id: "hiring", label: "Hiring", Section: HiringSection },
];

export function SourceSections({ competitorId: _competitorId, snapshots, plan }: SourceSectionsProps) {
  const entries = snapshots ?? {};

  // Sources the plan disables: present in the registry but excluded by the
  // plan's `sources` allowlist. Only computed when an allowlist exists.
  const lockedSources = plan ? planDisabledSources(plan) : [];

  return (
    <>
      {SOURCE_SECTION_ENTRIES.map((entry) => {
        const data = entries[entry.id];
        const Section = entry.Section;
        return (
          <Section
            key={entry.id}
            snapshot={data?.snapshot ?? null}
            diff={data?.diff ?? []}
          />
        );
      })}
      {lockedSources.map((source) => (
        <p key={`locked-${source.id}`} className="f9-source-locked-line">
          {source.label} is not available on your plan.
        </p>
      ))}
    </>
  );
}

/**
 * Return the registry sources the given plan excludes. The `sources`
 * entitlement is added by #2212; until then `getPlanEntitlements(plan)`
 * has no `sources` field and this returns [] (all sources allowed).
 */
function planDisabledSources(plan: PlanFamily): { id: SourceId; label: string }[] {
  const entitlements = getPlanEntitlements(plan) as { sources?: SourceId[] | "all" };
  const allowed = entitlements.sources;
  if (!allowed || allowed === "all") return [];
  const allowedSet = new Set(allowed);
  return SOURCE_SECTION_ENTRIES.filter((entry) => !allowedSet.has(entry.id)).map((entry) => ({
    id: entry.id,
    label: entry.label,
  }));
}
