import type { ReactElement } from "react";

import { competitorJustAdded, EmptyState } from "./empty-state";

const HEADING = "mb-3 font-mono text-eyebrow text-ink-soft uppercase";

const SNAPSHOT_CELLS = [
  "Ads running",
  "New ads",
  "Site changes",
  "Mentions",
  "Open roles",
  "Standing",
] as const;

export function CompetitorFrame(): ReactElement {
  return (
    <div
      data-slot="competitor-frame"
      className="grid min-w-0 gap-10 min-[1080px]:grid-cols-[minmax(0,1fr)_20rem]"
    >
      <div className="flex min-w-0 flex-col gap-10">
        <section
          data-section="snapshot"
          aria-labelledby="competitor-snapshot"
          className="min-w-0"
        >
          <h2 id="competitor-snapshot" className={HEADING}>
            This week
          </h2>
          <dl className="grid grid-cols-2 border border-line min-[860px]:grid-cols-3 min-[1080px]:grid-cols-6">
            {SNAPSHOT_CELLS.map((label) => (
              <div key={label} className="min-w-0 border border-line p-3">
                <dt className="font-mono text-meta text-ink-soft uppercase">{label}</dt>
                <dd className="font-display text-[1.4rem]">—</dd>
              </div>
            ))}
          </dl>
        </section>
        <section
          data-section="biggest-move"
          aria-labelledby="competitor-biggest-move"
          className="min-w-0"
        >
          <h2 id="competitor-biggest-move" className={HEADING}>
            The week's biggest move
          </h2>
          <EmptyState sentence="The biggest move needs a first mark. Site changes need a second snapshot, so the first one comes tomorrow." />
        </section>
        <section
          data-section="developments"
          aria-labelledby="competitor-developments"
          className="min-w-0"
        >
          <h2 id="competitor-developments" className={HEADING}>
            Developments
          </h2>
          <EmptyState {...competitorJustAdded()} />
        </section>
      </div>
      <aside data-slot="competitor-rail" className="flex min-w-0 flex-col gap-10">
        <section
          data-section="peers"
          aria-labelledby="competitor-peers"
          className="min-w-0"
        >
          <h2 id="competitor-peers" className={HEADING}>
            Peers
          </h2>
          <EmptyState sentence="Where this brand stands against the others you track shows here once the first week's counts are in." />
        </section>
        <section
          data-section="facts"
          aria-labelledby="competitor-facts"
          className="min-w-0"
        >
          <h2 id="competitor-facts" className={HEADING}>
            Thirty days
          </h2>
          <EmptyState sentence="Thirty days of facts build up here, one day at a time, from today." />
        </section>
        <section
          data-section="sources"
          aria-labelledby="competitor-sources"
          className="min-w-0"
        >
          <h2 id="competitor-sources" className={HEADING}>
            Sources on this brand
          </h2>
          <EmptyState sentence="Each source shows here as live or degraded once its first read lands, within the hour." />
        </section>
        <section
          data-section="verdict"
          aria-labelledby="competitor-verdict"
          className="min-w-0"
        >
          <h2 id="competitor-verdict" className={HEADING}>
            Still a competitor?
          </h2>
          <EmptyState sentence="We ask this once a week. The first answer, with its date, lands after the first full week." />
        </section>
      </aside>
    </div>
  );
}
