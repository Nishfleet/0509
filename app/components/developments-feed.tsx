import { useMemo } from "react";
import type { ReactElement } from "react";
import { useSearchParams } from "react-router";

import type { DevelopmentItem } from "../lib/developments";
import {
  FEED_FILTERS,
  FEED_PARAM,
  SOURCE_LABEL,
  countByKind,
  emptyFeedSentence,
  filterFeed,
  parseFeedFilter,
} from "../lib/developments";
import { httpUrl } from "../lib/http-url";
import { EmptyState } from "./empty-state";
import { SiteChangeItem, type SiteChangeItemData } from "./site-change-item";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

type FeedRow = DevelopmentItem & { when: string };

const LINK = "inline-flex min-h-11 items-center underline decoration-1 underline-offset-4";

const NEW_TAB_HINT = " (opens in a new tab)";

function findChange(changes: readonly SiteChangeItemData[], id: string): SiteChangeItemData | undefined {
  return changes.find((entry) => entry.id === id);
}

function DevelopmentArticle({ item }: { item: FeedRow }): ReactElement {
  const heading = item.title ?? item.summary ?? SOURCE_LABEL[item.kind];
  const href = item.url === null ? null : httpUrl(item.url);
  return (
    <article data-testid="development" className="mt-8 min-w-0 border-t border-line pt-6">
      <h3 className="font-display text-row-name font-bold [overflow-wrap:anywhere]">
        {href === null ? (
          heading
        ) : (
          <a href={href} rel="noopener noreferrer nofollow" target="_blank" className={LINK}>
            {heading}
            <span className="sr-only">{NEW_TAB_HINT}</span>
          </a>
        )}
      </h3>
      {item.title !== null && item.summary !== null ? (
        <p className="leading-[1.65] [overflow-wrap:anywhere]">{item.summary}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span data-slot="source-pill" className="border border-line px-1.5 font-mono text-pill uppercase">
          {SOURCE_LABEL[item.kind]}
        </span>
        <span className="font-mono text-meta text-ink-soft uppercase">{item.when}</span>
      </div>
    </article>
  );
}

function DevelopmentRow({ item, changes }: { item: FeedRow; changes: readonly SiteChangeItemData[] }): ReactElement {
  const change = item.kind === "change" ? findChange(changes, item.id) : undefined;
  return (
    <li data-kind={item.kind}>
      {change === undefined ? <DevelopmentArticle item={item} /> : <SiteChangeItem change={change} />}
    </li>
  );
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
        aria-label="Filter updates"
        value={[filter]}
        onValueChange={(values) => {
          const next = parseFeedFilter(values[0] ?? null);
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
            <EmptyState sentence={emptyFeedSentence(filter)} />
          </li>
        ) : (
          visible.map((item) => <DevelopmentRow key={item.id} item={item} changes={changes} />)
        )}
      </ol>
    </div>
  );
}
