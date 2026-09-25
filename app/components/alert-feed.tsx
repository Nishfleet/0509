import { useState, type ReactElement } from "react";

import { showInFeed } from "../lib/mention-feed";
import { AlertFeedRow, type AlertFeedItem } from "./alert-row";

export function AlertFeed({
  groups,
}: {
  groups: { group: string; items: AlertFeedItem[] }[];
}): ReactElement {
  const [showAll, setShowAll] = useState(false);
  const held = groups.some((group) => group.items.some((item) => !showInFeed(item, false)));
  const visible = groups
    .map((group) => ({
      group: group.group,
      items: group.items.filter((item) => showInFeed(item, showAll)),
    }))
    .filter((group) => group.items.length > 0);
  return (
    <>
      {held && !showAll ? (
        <button
          type="button"
          data-testid="mentions-show-all"
          className="text-ink-soft mt-8 inline-flex min-h-11 items-center font-mono text-meta uppercase underline"
          onClick={() => {
            setShowAll(true);
          }}
        >
          Show all
        </button>
      ) : null}
      {visible.map((group, groupIndex) => (
        <section key={group.group} data-testid="alert-day">
          <h2 className="text-ink-soft mt-10 font-mono text-[0.75rem] tracking-[0.04em] uppercase">{group.group}</h2>
          {group.items.map((item, index) => (
            <AlertFeedRow key={item.id} item={item} eager={groupIndex === 0 && index === 0} />
          ))}
        </section>
      ))}
    </>
  );
}
