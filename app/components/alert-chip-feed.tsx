import { Link, useSearchParams } from "react-router";

import { groupsInChip, parseAlertChip, type AlertChipKey } from "../lib/alert-chips";
import { AlertChipEmpty } from "./alert-chip-empty";
import { AlertChips } from "./alert-chips";
import { AlertFeed } from "./alert-feed";
import type { AlertFeedItem } from "./alert-row";

export function ChipFeed({
  groups,
  counts,
  hiringCapped,
  hasOpenIncident,
}: {
  groups: { group: string; items: AlertFeedItem[] }[];
  counts: Record<AlertChipKey, number>;
  hiringCapped: boolean;
  hasOpenIncident: boolean;
}) {
  const [searchParams] = useSearchParams();
  const chip = parseAlertChip(searchParams.get("kind"));
  const shown = groupsInChip(groups, chip);
  return (
    <>
      <AlertChips chip={chip} counts={counts} hiringCapped={hiringCapped} />
      {counts.all === 0 && !hasOpenIncident ? (
        <>
          <p className="mt-8 leading-[1.65]">
            Nothing yet. When a competitor changes its website, gets a mention or posts a job, it will show up here.
          </p>
          <Link
            className="mt-2 inline-flex min-h-11 items-center font-display font-bold underline decoration-1 underline-offset-4"
            to="/app/competitors"
          >
            See who you are watching
          </Link>
        </>
      ) : (
        <AlertChipEmpty chip={chip} counts={counts} groups={shown} />
      )}
      <AlertFeed groups={shown} />
    </>
  );
}
