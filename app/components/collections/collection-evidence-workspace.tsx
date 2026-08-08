import { Form, Link } from "react-router";

import { ConfirmSubmitButton } from "~/components/confirm-button";
import { SavedEvidenceItem } from "~/components/collections/saved-evidence-item";
import { LocalTime } from "~/components/local-time";
import { SubmitButton } from "~/components/submit-button";
import { DetailPane } from "~/components/workspace/detail-pane";
import { RuledList, RuledRow } from "~/components/workspace/ruled-list";
import {
  COLLECTION_FILTERED_EMPTY_COPY,
  COLLECTION_ITEMS_EMPTY_COPY,
  collectionHref,
  collectionItemHref,
  formatRecordedObservationDate,
  resolveSavedItemCapturedAt,
  resolveSavedItemSourceKind,
  resolveSavedItemStatus,
  savedItemRowSummary,
} from "~/lib/collections-display";
import { formatAdvertiserLabel } from "~/lib/landing-page-display";
import type { CollectionItemRecord, CollectionRecord } from "~/lib/types";

export function CollectionEvidenceWorkspace({
  advertiserFilter,
  collection,
  hiddenByFilter,
  items,
  selectedItem,
}: {
  advertiserFilter: string | null;
  collection: CollectionRecord;
  hiddenByFilter: number;
  items: readonly CollectionItemRecord[];
  selectedItem: CollectionItemRecord | null;
}) {
  return (
    <>
      <div className={`f9-wk-split f9-library-split${selectedItem ? "" : " is-single"}`}>
        <div className="f9-wk-split-list">
          {items.length > 0 ? (
            <RuledList aria-label={`Saved evidence in ${collection.name}`} flush>
              {items.map((item) => (
                <RuledRow
                  key={item.id}
                  name={formatAdvertiserLabel(item.ad.advertiser)}
                  say={savedItemRowSummary(item)}
                  selected={selectedItem?.id === item.id}
                  status={resolveSavedItemStatus(item.ad.source)}
                  statusTone={
                    resolveSavedItemSourceKind(item.ad.source) === "captured" ? "on" : "quiet"
                  }
                  time={savedItemTime(item)}
                  to={collectionItemHref(collection.id, item.id, advertiserFilter)}
                />
              ))}
            </RuledList>
          ) : (
            <section aria-labelledby="collection-empty-title" className="f9-library-list-empty">
              <h2 className="f9-library-section-title" id="collection-empty-title">
                {advertiserFilter ? "No matching evidence" : "Nothing filed here yet"}
              </h2>
              <p>
                {advertiserFilter
                  ? COLLECTION_FILTERED_EMPTY_COPY
                  : COLLECTION_ITEMS_EMPTY_COPY}
              </p>
              <div className="f9-wk-acts">
                {advertiserFilter ? (
                  <Link className="f9-wk-lnk" to={collectionHref(collection.id)}>
                    Clear filter <span aria-hidden="true" className="f9-wk-chev">&rsaquo;</span>
                  </Link>
                ) : (
                  <Link className="f9-wk-lnk" to="/search">
                    Save evidence from search{" "}
                    <span aria-hidden="true" className="f9-wk-chev">&rsaquo;</span>
                  </Link>
                )}
              </div>
            </section>
          )}
        </div>

        {selectedItem ? (
          <DetailPane
            key={selectedItem.id}
            label={`${formatAdvertiserLabel(selectedItem.ad.advertiser)} saved evidence`}
          >
            <SavedEvidenceItem
              collectionName={collection.name}
              editor={
                <>
                  <Form className="f9-library-form" method="post">
                    <input name="intent" type="hidden" value="update-item" />
                    <input name="itemId" type="hidden" value={selectedItem.id} />
                    <label className="f9-field">
                      <span>Note</span>
                      <textarea defaultValue={selectedItem.note ?? ""} name="note" rows={2} />
                    </label>
                    <label className="f9-field">
                      <span>Tags</span>
                      <input defaultValue={selectedItem.tags.join(", ")} name="tags" />
                    </label>
                    <SubmitButton
                      className="f9-wk-lnk"
                      intent="update-item"
                      match={{ itemId: selectedItem.id }}
                      pendingLabel="Saving…"
                    >
                      Save note and tags
                    </SubmitButton>
                  </Form>
                  <Form method="post">
                    <input name="intent" type="hidden" value="remove-item" />
                    <input name="itemId" type="hidden" value={selectedItem.id} />
                    <ConfirmSubmitButton
                      className="f9-wk-lnk"
                      confirmLabel="Confirm — remove?"
                      intent="remove-item"
                      match={{ itemId: selectedItem.id }}
                      pendingLabel="Removing…"
                      variant="light"
                    >
                      Remove from collection
                    </ConfirmSubmitButton>
                  </Form>
                </>
              }
              item={selectedItem}
            />
          </DetailPane>
        ) : null}
      </div>

      {advertiserFilter && items.length > 0 ? (
        <p className="f9-library-filter-line">
          Showing saved evidence matching “{advertiserFilter}”.
          {hiddenByFilter > 0
            ? ` ${hiddenByFilter} other saved ${hiddenByFilter === 1 ? "item is" : "items are"} hidden.`
            : ""}
          {" "}
          <Link to={collectionHref(collection.id)}>Clear filter</Link>.
        </p>
      ) : null}
    </>
  );
}

function savedItemTime(item: CollectionItemRecord) {
  const capturedAt = resolveSavedItemCapturedAt(item);
  if (capturedAt) return <LocalTime iso={capturedAt} mode="date" />;
  const kind = resolveSavedItemSourceKind(item.ad.source);
  if (kind === "filed") {
    return formatRecordedObservationDate(item.ad.firstSeenAt) ?? "Date not recorded";
  }
  if (kind === "sample") {
    return "Sample";
  }
  // A captured item with no stored capture time is the most ambiguous case
  // in the list; a bare dash reads as decoration, not as a missing value.
  return "Capture time not recorded";
}
