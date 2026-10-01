import type { ReactElement } from "react";

import { WATCHED_NOUNS } from "../lib/coverage";
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
      ? "We'll show when your first site snapshots arrive once the first check is scheduled"
      : `Your first site snapshots arrive by ${firstSweepAt}`;
  const sentence = `We're collecting your first week of data: ${WATCHED_NOUNS} for ${String(brands)} ${brands === 1 ? "brand" : "brands"}. ${sweepLine}. Your first ranking arrives with your brief on ${briefAt}.`;
  return (
    <div data-home="first-file">
      <EmptyState sentence={sentence} />
    </div>
  );
}
