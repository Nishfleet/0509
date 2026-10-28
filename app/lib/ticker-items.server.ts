import { agoLabel } from "./ago-label";
import { changeHeadline, parseSiteChangePayload } from "./site-change";
import type { TickerItem } from "./ticker";

export function tickerItems(
  rows: readonly {
    id: string;
    entity_name: string | null;
    entity_domain: string;
    payload_json: string;
    observed_at: string;
  }[],
  now: Date,
): TickerItem[] {
  return rows
    .flatMap((row) => {
      const payload = parseSiteChangePayload(row.payload_json);
      if (payload === null) return [];
      return [
        {
          id: row.id,
          text: changeHeadline({
            name: row.entity_name ?? row.entity_domain,
            isSelf: false,
            role: payload.page.role,
          }),
          ago: agoLabel(row.observed_at, now),
        },
      ];
    })
    .slice(0, 12);
}
