import type { ReactElement } from "react";

import { BiggestMove } from "./biggest-move";
import { DevelopmentsFeed } from "./developments-feed";
import { EmptyState } from "./empty-state";
import { CompetitorRail, type CompetitorRailProps } from "./competitor-rail";
import type { SiteChangeItemData } from "./site-change-item";
import { SITE_SWEEP_UTC_LABEL } from "../lib/cadence";
import type { BiggestMoveView } from "../lib/biggest-move";
import type { DevelopmentItem } from "../lib/developments";

const HEADING = "mb-3 font-mono text-eyebrow text-ink-soft uppercase";

export interface CompetitorFrameProps {
  changes: readonly SiteChangeItemData[];
  developments: readonly (DevelopmentItem & { when: string })[];
  weekCount: number;
  biggestMove: BiggestMoveView | null;
  quiet: string;
  pages: number;
  lastChecked: string | null;
  pausedOn: string | null;
  unreadable: boolean;
  rail: Omit<CompetitorRailProps, "lastChecked">;
}

export function developmentsEmpty(lastChecked: string | null): string {
  if (lastChecked === null) {
    return `Watching from today. We read the homepage every night at ${SITE_SWEEP_UTC_LABEL}, and the first change shows here after the second read.`;
  }
  return `No changes to the homepage since we started watching. We read it again every night at ${SITE_SWEEP_UTC_LABEL}.`;
}

function Cell({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="min-w-0 border border-line p-3">
      <dt className="font-mono text-meta text-ink-soft uppercase">{label}</dt>
      <dd className="font-display text-[1.4rem] [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

type SnapshotProps = Pick<CompetitorFrameProps, "weekCount" | "pages" | "lastChecked">;

function SnapshotSection({ weekCount, pages, lastChecked }: SnapshotProps): ReactElement {
  return (
    <section data-section="snapshot" aria-labelledby="competitor-snapshot" className="min-w-0">
      <h2 id="competitor-snapshot" className={HEADING}>
        This week
      </h2>
      <dl className="grid grid-cols-1 border border-line min-[480px]:grid-cols-3">
        <Cell label="Site changes" value={String(weekCount)} />
        <Cell label="Pages watched" value={String(pages)} />
        <Cell label="Last checked" value={lastChecked ?? "Not yet"} />
      </dl>
    </section>
  );
}

type BiggestMoveSectionProps = Pick<CompetitorFrameProps, "biggestMove" | "quiet" | "changes">;

function BiggestMoveSection({ biggestMove, quiet, changes }: BiggestMoveSectionProps): ReactElement {
  return (
    <section data-section="biggest-move" aria-labelledby="competitor-biggest-move" className="min-w-0">
      <h2 id="competitor-biggest-move" className={HEADING}>
        The week's biggest move
      </h2>
      <BiggestMove
        move={biggestMove}
        quiet={quiet}
        change={changes.find((change) => change.id === biggestMove?.id) ?? null}
      />
    </section>
  );
}

type DevelopmentsSectionProps = Pick<
  CompetitorFrameProps,
  "changes" | "developments" | "lastChecked" | "pausedOn" | "unreadable"
>;

function DevelopmentsSection({
  changes,
  developments,
  lastChecked,
  pausedOn,
  unreadable,
}: DevelopmentsSectionProps): ReactElement {
  return (
    <section data-section="developments" aria-labelledby="competitor-developments" className="min-w-0">
      <h2 id="competitor-developments" className={HEADING}>
        What's new
      </h2>
      {pausedOn === null ? null : (
        <p data-slot="feed-paused" className="border-t border-ink pt-3 text-meta text-ink-soft">
          Paused {pausedOn}. We've stopped checking. Turn it back on to pick up where it left off.
        </p>
      )}
      {unreadable ? (
        <p data-slot="site-unreadable" className="border-t border-ink pt-3 text-meta text-ink-soft">
          We couldn't read their website. It may block automated visits. We'll keep trying, and we're still watching
          everything else about them.
        </p>
      ) : null}
      {developments.length === 0 ? (
        <EmptyState sentence={developmentsEmpty(lastChecked)} />
      ) : (
        <DevelopmentsFeed items={developments} changes={changes} />
      )}
    </section>
  );
}

export function CompetitorFrame({
  changes,
  developments,
  weekCount,
  biggestMove,
  quiet,
  pages,
  lastChecked,
  pausedOn,
  unreadable,
  rail,
}: CompetitorFrameProps): ReactElement {
  return (
    <div data-slot="competitor-frame" className="grid min-w-0 gap-10 min-[1080px]:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex min-w-0 flex-col gap-10">
        <SnapshotSection weekCount={weekCount} pages={pages} lastChecked={lastChecked} />
        <BiggestMoveSection biggestMove={biggestMove} quiet={quiet} changes={changes} />
        <DevelopmentsSection
          changes={changes}
          developments={developments}
          lastChecked={lastChecked}
          pausedOn={pausedOn}
          unreadable={unreadable}
        />
      </div>
      <CompetitorRail {...rail} lastChecked={lastChecked} />
    </div>
  );
}
