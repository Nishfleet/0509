import { Form, Link } from "react-router";

import {
  COLLECTION_PANEL_GROUP,
  CollectionDisclosure,
} from "~/components/collections/collection-disclosure";
import { ConfirmSubmitButton } from "~/components/confirm-button";
import { SubmitButton } from "~/components/submit-button";
import { DetailFacts } from "~/components/workspace/detail-pane";
import { buildCollectionFacts } from "~/lib/collections-display";
import { createReportId } from "~/lib/report";
import type { CollectionItemRecord, CollectionRecord } from "~/lib/types";

export function CollectionDetailsSection({
  canExport,
  canOpenReport,
  canShare,
  collection,
  collectionLimit,
  collectionsUsed,
  hiddenByFilter,
  items,
  lockedActionsLabel,
}: {
  canExport: boolean;
  canOpenReport: boolean;
  canShare: boolean;
  collection: CollectionRecord;
  collectionLimit: number;
  collectionsUsed: number;
  hiddenByFilter: number;
  items: readonly CollectionItemRecord[];
  lockedActionsLabel: string | null;
}) {
  return (
    <section aria-labelledby="collection-details-title" className="f9-wk-sec f9-library-section">
      <p className="f9-wk-kick">Collection details</p>
      <h2 className="f9-library-entity-title" id="collection-details-title">
        {collection.name}
      </h2>
      {collection.description ? <p className="f9-library-note">{collection.description}</p> : null}
      <div className="f9-library-facts">
        <DetailFacts
          rows={buildCollectionFacts({
            collection,
            collectionLimit,
            collectionsUsed,
            hiddenByFilter,
            items,
          }).map((row) => ({
            key: row.key,
            value: row.value ?? row.missingLabel ?? "Not recorded",
          }))}
        />
      </div>

      <div aria-label="Collection actions" className="f9-library-actions">
        {canOpenReport ? (
          <Link
            className="f9-wk-lnk"
            to={`/app/reports/${createReportId("collection", collection.id)}`}
          >
            Package for client <span aria-hidden="true" className="f9-wk-chev">&rsaquo;</span>
          </Link>
        ) : null}

        {canExport ? (
          <CollectionDisclosure
            className="f9-library-export"
            group={COLLECTION_PANEL_GROUP}
            summary="Export collection"
          >
            <a className="f9-wk-lnk" href={`/export/collection/${collection.id}`}>
              Export CSV
            </a>
            <a
              className="f9-wk-lnk"
              href={`/export/collection/${collection.id}?format=json`}
            >
              Export JSON
            </a>
          </CollectionDisclosure>
        ) : null}

        {canShare ? (
          <Form method="post">
            <input name="intent" type="hidden" value="share-collection" />
            <input name="collectionId" type="hidden" value={collection.id} />
            <SubmitButton
              className="f9-wk-lnk"
              intent="share-collection"
              pendingLabel="Creating…"
            >
              Create share link
            </SubmitButton>
          </Form>
        ) : null}

        {lockedActionsLabel ? (
          <div className="f9-library-upgrade-note">
            <p>{lockedActionsLabel}. Your saved evidence stays available on this plan.</p>
            <Link className="f9-wk-lnk" to="/app/billing?source=collections#plans">
              Compare plans <span aria-hidden="true" className="f9-wk-chev">&rsaquo;</span>
            </Link>
          </div>
        ) : null}

        <CollectionDisclosure
          className="f9-library-rename"
          group={COLLECTION_PANEL_GROUP}
          summary="Rename collection"
        >
          <Form method="post">
            <input name="intent" type="hidden" value="rename-collection" />
            <input name="collectionId" type="hidden" value={collection.id} />
            <label className="f9-wk-field">
              <span className="f9-wk-lab">Name</span>
              <input
                className="f9-wk-in"
                defaultValue={collection.name}
                name="name"
                placeholder="e.g. Launch proof"
                required
                type="text"
              />
            </label>
            <SubmitButton
              className="f9-wk-lnk"
              intent="rename-collection"
              pendingLabel="Renaming…"
            >
              Rename collection
            </SubmitButton>
          </Form>
        </CollectionDisclosure>

        <Form method="post">
          <input name="intent" type="hidden" value="delete-collection" />
          <input name="collectionId" type="hidden" value={collection.id} />
          <ConfirmSubmitButton
            className="f9-wk-lnk"
            confirmLabel="Confirm — delete collection?"
            intent="delete-collection"
            pendingLabel="Deleting…"
            variant="light"
          >
            Delete collection
          </ConfirmSubmitButton>
        </Form>
      </div>
    </section>
  );
}
