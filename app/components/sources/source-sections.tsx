import { SOURCES } from "~/lib/sources/registry";
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
 */

export interface SourceSectionsProps {
  competitorId: string;
  snapshots?: Record<string, { snapshot: SourceSnapshotRecord | null; diff: SourceChange[] }>;
  /** The competitor owner's plan family; drives plan-locked source lines. */
  plan?: PlanFamily;
}

export function SourceSections({ competitorId: _competitorId, snapshots, plan }: SourceSectionsProps) {
  const entries = snapshots ?? {};

  // Sources the plan disables: present in the registry but excluded by the
  // plan's `sources` allowlist. Only computed when an allowlist exists.
  const lockedSources = plan ? planDisabledSources(plan) : [];

  return (
    <>
      {SOURCES.map((adapter) => {
        const entry = entries[adapter.id];
        const Section = adapter.Section;
        return (
          <Section
            key={adapter.id}
            snapshot={entry?.snapshot ?? null}
            diff={entry?.diff ?? []}
          />
        );
      })}
      {lockedSources.map((adapter) => (
        <p key={`locked-${adapter.id}`} className="f9-source-locked-line">
          {adapter.label} is not available on your plan.
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
  return SOURCES.filter((adapter) => !allowedSet.has(adapter.id)).map((adapter) => ({
    id: adapter.id,
    label: adapter.label,
  }));
}
