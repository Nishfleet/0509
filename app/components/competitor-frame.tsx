import type { ReactElement } from "react";

import { EmptyState } from "./empty-state";
import { SiteChangeItem } from "./site-change-item";
import type { SiteChangeItemData } from "./site-change-item";

const HEADING = "mb-3 font-mono text-eyebrow text-ink-soft uppercase";

export interface CompetitorFrameProps {
  changes: readonly SiteChangeItemData[];
  weekCount: number;
  biggestId: string | null;
  pages: number;
  lastChecked: string | null;
  pausedOn: string | null;
}

export function developmentsEmpty(lastChecked: string | null): string {
  if (lastChecked === null) {
    return "Watching from today. We read the homepage every night at 02:00 UTC, and the first change shows here after the second read.";
  }
  return "No changes to the homepage since we started watching. We read it again every night at 02:00 UTC.";
}

function Cell({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="min-w-0 border border-line p-3">
      <dt className="font-mono text-meta text-ink-soft uppercase">{label}</dt>
      <dd className="font-display text-[1.4rem] [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

export function CompetitorFrame({
  changes,
  weekCount,
  biggestId,
  pages,
  lastChecked,
  pausedOn,
}: CompetitorFrameProps): ReactElement {
  const biggest = changes.find((change) => change.id === biggestId) ?? null;
  return (
    <div
      data-slot="competitor-frame"
      className="grid min-w-0 gap-10 min-[1080px]:grid-cols-[minmax(0,1fr)_20rem]"
    >
      <div className="flex min-w-0 flex-col gap-10">
        <section data-section="snapshot" aria-labelledby="competitor-snapshot" className="min-w-0">
          <h2 id="competitor-snapshot" className={HEADING}>
            This week
          </h2>
          <dl className="grid grid-cols-1 border border-line min-[480px]:grid-cols-3">
            <Cell label="Site changes" value={String(weekCount)} />
            <Cell label="Pages watched" value={String(pages)} />
            <Cell label="Last checked" value={lastChecked ?? "Tonight"} />
          </dl>
        </section>
        <section data-section="biggest-move" aria-labelledby="competitor-biggest-move" className="min-w-0">
          <h2 id="competitor-biggest-move" className={HEADING}>
            The week's biggest move
          </h2>
          {biggest === null ? (
            <EmptyState sentence="Nothing moved on their site in the last 7 days. We read it again every night at 02:00 UTC." />
          ) : (
            <SiteChangeItem change={biggest} size="md" eager />
          )}
        </section>
        <section data-section="developments" aria-labelledby="competitor-developments" className="min-w-0">
          <h2 id="competitor-developments" className={HEADING}>
            Developments
          </h2>
          {pausedOn === null ? null : (
            <p data-slot="feed-paused" className="border-ink border-t pt-3 text-meta text-ink-soft">
              Paused {pausedOn}. We stopped checking here; turn it back on to pick up where it left off.
            </p>
          )}
          {changes.length === 0 ? (
            <EmptyState sentence={developmentsEmpty(lastChecked)} />
          ) : (
            changes.map((change) => <SiteChangeItem key={change.id} change={change} />)
          )}
        </section>
      </div>
      <aside data-slot="competitor-rail" className="flex min-w-0 flex-col gap-10">
        <section data-section="sources" aria-labelledby="competitor-sources" className="min-w-0">
          <h2 id="competitor-sources" className={HEADING}>
            Sources on this brand
          </h2>
          <p className="font-display text-[1.02rem]">Website</p>
          <p className="text-meta text-ink-soft">
            {lastChecked === null
              ? "Homepage, read every night. First read tonight at 02:00 UTC."
              : `Homepage, read every night. Last read ${lastChecked}.`}
          </p>
        </section>
      </aside>
    </div>
  );
}
