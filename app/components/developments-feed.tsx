import { useMemo } from "react";
import type { ReactElement } from "react";
import { useSearchParams } from "react-router";

import type { DevelopmentItem, FeedFilter } from "../lib/developments";
import {
  FEED_FILTERS,
  FEED_PARAM,
  SOURCE_LABEL,
  countByKind,
  filterFeed,
  parseFeedFilter,
} from "../lib/developments";
import { EmptyState } from "./empty-state";
import { SiteChangeItem, type SiteChangeItemData } from "./site-change-item";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

type FeedRow = DevelopmentItem & { when: string };

function isFilter(value: unknown): value is FeedFilter {
  return typeof value === "string" && FEED_FILTERS.some((entry) => entry.value === value);
}

function pickFilter(values: readonly unknown[]): FeedFilter {
  const last = values.at(-1);
  return isFilter(last) ? last : "all";
}

function findChange(changes: readonly SiteChangeItemData[], id: string): SiteChangeItemData | undefined {
  return changes.find((entry) => entry.id === id);
}

export function DevelopmentsFeed({
  items,
  changes,
}: {
  items: readonly FeedRow[];
  changes: readonly SiteChangeItemData[];
}): ReactElement {
  const [params, setParams] = useSearchParams();
  const filter = parseFeedFilter(params.get(FEED_PARAM));
  const counts = useMemo(() => countByKind(items), [items]);
  const visible = useMemo(() => filterFeed(items, filter), [items, filter]);

  return (
    <div data-slot="developments-feed" className="flex min-w-0 flex-col gap-4">
      <ToggleGroup
        aria-label="Filter developments"
        value={[filter]}
        onValueChange={(values) => {
          const next = pickFilter(values);
          setParams(next === "all" ? {} : { [FEED_PARAM]: next }, { replace: true, preventScrollReset: true });
        }}
        className="flex min-w-0 flex-wrap gap-2"
      >
        {FEED_FILTERS.map((entry) => (
          <ToggleGroupItem key={entry.value} value={entry.value}>
            {entry.label}
            <span className="font-mono text-meta">{counts[entry.value]}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <ol data-slot="developments-list" className="flex min-w-0 flex-col">
        {visible.length === 0 ? (
          <li>
            <EmptyState sentence="Nothing of this kind in the last 90 days." />
          </li>
        ) : (
          visible.map((item) => {
            const heading = item.title ?? item.summary ?? SOURCE_LABEL[item.kind];
            const change = item.kind === "change" ? findChange(changes, item.id) : undefined;
            return (
              <li key={item.id} data-kind={item.kind}>
                {change === undefined ? (
                  <article
                    data-testid="development"
                    className="border-line mt-8 min-w-0 border-t pt-6"
                  >
                    <h3 className="font-display text-row-name font-bold [overflow-wrap:anywhere]">
                      {heading}
                    </h3>
                    {item.title !== null && item.summary !== null ? (
                      <p className="leading-[1.65] [overflow-wrap:anywhere]">{item.summary}</p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span
                        data-slot="source-pill"
                        className="border border-line px-1.5 font-mono text-pill uppercase"
                      >
                        {SOURCE_LABEL[item.kind]}
                      </span>
                      <span className="font-mono text-meta text-ink-soft uppercase">{item.when}</span>
                    </div>
                  </article>
                ) : (
                  <SiteChangeItem change={change} />
                )}
              </li>
            );
          })
        )}
      </ol>
    </div>
  );
}