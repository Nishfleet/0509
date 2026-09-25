import type { ReactElement } from "react";

import { EmptyState } from "./empty-state";

export function FirstFilePanel({
  brands,
  firstSweepAt,
  briefAt,
}: {
  brands: number;
  firstSweepAt: string | null;
  briefAt: string;
}): ReactElement {
  const sweepLine =
    firstSweepAt === null
      ? "We'll show the time your first site snapshots land as soon as the first sweep is scheduled"
      : `The first site snapshots land by ${firstSweepAt}`;
  const sentence = `We're gathering the first week: site snapshots, ads and mentions for ${String(brands)} brands. ${sweepLine}; your first read-this-first comes with the brief on ${briefAt}.`;
  return (
    <div data-home="first-file">
      <EmptyState sentence={sentence} />
    </div>
  );
}
