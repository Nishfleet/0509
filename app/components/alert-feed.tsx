import { useState, type ReactElement } from "react";

import { showInFeed } from "../lib/mention-feed";
import { AlertFeedRow, type AlertFeedItem } from "./alert-row";

export function AlertFeed({ groups }: { groups: { group: string; items: AlertFeedItem[] }[] }): ReactElement {
  const [showAll, setShowAll] = useState(false);
  const hidden = groups.reduce(
    (count, group) => count + group.items.filter((item) => !showInFeed(item, false)).length,
    0,
  );
  const visible = groups
    .map((group) => ({
      group: group.group,
      items: group.items.filter((item) => showInFeed(item, showAll)),
    }))
    .filter((group) => group.items.length > 0);
  return (
    <>
      {visible.map((group, groupIndex) => (
        <section key={group.group} data-testid="alert-day">
          <h2 className="mt-10 font-mono text-[0.75rem] tracking-[0.04em] text-ink-soft uppercase">{group.group}</h2>
          {group.items.map((item, index) => (
            <AlertFeedRow key={item.id} item={item} eager={groupIndex === 0 && index === 0} />
          ))}
        </section>
      ))}
      {hidden > 0 ? (
        <button
          type="button"
          data-testid="mentions-show-all"
          aria-expanded={showAll}
          className="mt-6 inline-flex min-h-11 items-center font-mono text-meta text-ink-soft uppercase underline"
          onClick={() => {
            setShowAll((open) => !open);
          }}
        >
          {showAll ? (
            <>Hide the {hidden} we think {hidden === 1 ? "does not matter" : "do not matter"}</>
          ) : (
            <>Show all, including {hidden} we think {hidden === 1 ? "does not matter" : "do not matter"}</>
          )}
        </button>
      ) : null}
    </>
  );
}
