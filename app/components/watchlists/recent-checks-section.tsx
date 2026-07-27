import { QuietLineList } from "~/components/evidence/quiet-line";
import { watchlistDetailTabHref } from "~/lib/watchlist-detail-tabs";
import type { WatchlistRunRecord } from "~/lib/types";

import { buildQuietCheckItems } from "./event-changes-section";

export function RecentChecksSection({
  runs,
  watchlistId,
  checksExpanded = false,
}: {
  runs: WatchlistRunRecord[];
  watchlistId: string;
  checksExpanded?: boolean;
}) {
  const items = buildQuietCheckItems(runs);

  return (
    <section aria-label="Recent checks">
      <p className="f9-ed-micro">Recent checks</p>
      {items.length === 0 ? (
        <p className="f9-muted-copy">
          No checks yet — the first one shows up here automatically.
        </p>
      ) : (
        <QuietLineList
          expanded={checksExpanded}
          items={items}
          loadMore={{
            to: `${watchlistDetailTabHref(watchlistId, "evidence")}&checks=all`,
          }}
        />
      )}
    </section>
  );
}
