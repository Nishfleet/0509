import type { ReactElement } from "react";

import { EmptyState } from "./empty-state";

export function FirstFilePanel({
  brands,
  firstSweepAt,
  briefAt,
}: {
  brands: number;
  firstSweepAt: string;
  briefAt: string;
}): ReactElement {
  return (
    <div data-home="first-file">
      <EmptyState
        sentence={`We're gathering the first week: site snapshots, ads and mentions for ${String(brands)} brands. The first site snapshots land by ${firstSweepAt}; your first read-this-first comes with the brief on ${briefAt}.`}
      />
    </div>
  );
}
