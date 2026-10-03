import type { ReactElement } from "react";

import { Link } from "react-router";

import { ALERT_CHIPS, type AlertChipKey } from "../lib/alert-chips";

const LABELS = new Map(ALERT_CHIPS.map((entry) => [entry.key, entry.label.toLowerCase()] as const));

function chipLabel(chip: AlertChipKey): string {
  const label = LABELS.get(chip);
  if (label === undefined) throw new Error(`alert chip ${chip} carries no label in ALERT_CHIPS`);
  return label;
}

export function AlertChipEmpty({
  chip,
  counts,
  groups,
}: {
  chip: AlertChipKey;
  counts: Record<AlertChipKey, number>;
  groups: readonly unknown[];
}): ReactElement | null {
  if (chip === "all" || groups.length > 0 || counts[chip] > 0) return null;
  return (
    <>
      <p data-testid="alert-chip-empty" className="mt-8 leading-[1.65]">
        No {chipLabel(chip)} alerts yet. Everything else is still under All.
      </p>
      <Link
        className="mt-2 inline-flex min-h-11 items-center underline decoration-1 underline-offset-4"
        to="/app/alerts"
      >
        See everything
      </Link>
    </>
  );
}
