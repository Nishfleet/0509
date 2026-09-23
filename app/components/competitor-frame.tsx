import type { ReactElement, ReactNode } from "react";

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

function Section({
  sectionKey,
  title,
  children,
}: {
  sectionKey: string;
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section
      data-section={sectionKey}
      aria-labelledby={`competitor-${sectionKey}`}
      className="min-w-0"
    >
      <h2 id={`competitor-${sectionKey}`} className={HEADING}>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function CompetitorFrame(): ReactElement {
  return (
    <div
      data-slot="competitor-frame"
      className="grid min-w-0 gap-10 min-[1080px]:grid-cols-[minmax(0,1fr)_20rem]"
    >
      <div className="flex min-w-0 flex-col gap-10">
        <Section sectionKey="snapshot" title="This week">
          <dl className="grid grid-cols-2 border border-line min-[860px]:grid-cols-3 min-[1080px]:grid-cols-6">
            {SNAPSHOT_CELLS.map((label) => (
              <div key={label} className="min-w-0 border border-line p-3">
                <dt className="font-mono text-meta text-ink-soft uppercase">{label}</dt>
                <dd className="font-display text-[1.4rem]">—</dd>
              </div>
            ))}
          </dl>
        </Section>
        <Section sectionKey="biggest-move" title="The week's biggest move">
          <EmptyState sentence="The biggest move needs a first mark. Site changes need a second snapshot, so the first one comes tomorrow." />
        </Section>
        <Section sectionKey="developments" title="Developments">
          <EmptyState {...competitorJustAdded()} />
        </Section>
      </div>
      <aside data-slot="competitor-rail" className="flex min-w-0 flex-col gap-10">
        <Section sectionKey="peers" title="Peers">
          <EmptyState sentence="Where this brand stands against the others you track shows here once the first week's counts are in." />
        </Section>
        <Section sectionKey="facts" title="Thirty days">
          <EmptyState sentence="Thirty days of facts build up here, one day at a time, from today." />
        </Section>
        <Section sectionKey="sources" title="Sources on this brand">
          <EmptyState sentence="Each source shows here as live or degraded once its first read lands, within the hour." />
        </Section>
        <Section sectionKey="verdict" title="Still a competitor?">
          <EmptyState sentence="We ask this once a week. The first answer, with its date, lands after the first full week." />
        </Section>
      </aside>
    </div>
  );
}
