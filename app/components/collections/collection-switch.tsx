import { Link } from "react-router";

import { collectionHref } from "~/lib/collections-display";
import type { CollectionRecord } from "~/lib/types";

/**
 * The collection switcher — brief §5 ("Non-button — Navigation") and §6.4.
 *
 * The old left rail was a stack of cards inside a card: the record list took
 * a third of the page and pushed the actual saved evidence into a squeezed
 * column. Switching collection is navigation, not a CTA, so it renders as one
 * sentence-case ruled row that scrolls inside its own container on mobile
 * (§9.1) and never borrows a button treatment.
 *
 * The active board has an ink underline and `aria-current`, so its state does
 * not rely on colour alone (§10).
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
    <nav aria-label="Collections" className="f9-wk-tabs f9-library-switch">
      {collections.map((collection) => {
        const active = collection.id === selectedId;
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={active ? "f9-wk-tab f9-library-switch-item is-on" : "f9-wk-tab f9-library-switch-item"}
            key={collection.id}
            to={collectionHref(collection.id, advertiserFilter)}
          >
            {collection.name}
          </Link>
        );
      })}
    </nav>
  );
}
