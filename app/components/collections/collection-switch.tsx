import { Link } from "react-router";

import { collectionHref } from "~/lib/collections-display";
import type { CollectionRecord } from "~/lib/types";

/**
 * The collection switcher — brief §5 ("Non-button — Navigation") and §6.4.
 *
 * The old left rail was a stack of cards inside a card: the record list took
 * a third of the page and pushed the actual saved evidence into a squeezed
 * column. Switching collection is navigation, not a CTA, so it renders as one
 * mono ruled row that scrolls inside its own container on mobile (§9.1) and
 * never borrows a button treatment.
 *
 * The active board is ink-filled AND carries `aria-current`, so the fill is
 * not the only active-state signal (§10).
 */
export function CollectionSwitch({
  collections,
  selectedId,
  advertiserFilter,
}: {
  collections: readonly CollectionRecord[];
  selectedId: string | null;
  advertiserFilter: string | null;
}) {
  if (collections.length === 0) return null;

  return (
    <nav aria-label="Collections" className="f9-ed-switch">
      <span className="f9-ed-switch-label f9-ed-micro">Collections</span>
      <div className="f9-ed-switch-track">
        {collections.map((collection) => {
          const active = collection.id === selectedId;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={active ? "f9-ed-switch-item is-active" : "f9-ed-switch-item"}
              key={collection.id}
              to={collectionHref(collection.id, advertiserFilter)}
            >
              {collection.name}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
