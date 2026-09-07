import type { ReactNode } from "react";

import { AdThumb } from "~/components/ad-thumb";
import {
  COLLECTION_ITEM_GROUP,
  CollectionDisclosure,
} from "~/components/collections/collection-disclosure";
import { LocalTime } from "~/components/local-time";
import {
  DetailBlock,
  DetailFacts,
  DetailPaneHead,
} from "~/components/workspace/detail-pane";
import {
  buildSavedItemFacts,
  resolveSavedItemCapturedAt,
  resolveSavedItemChannel,
  resolveSavedItemPlate,
  resolveSavedItemStatus,
  savedItemFootnote,
  savedItemProofLink,
} from "~/lib/collections-display";
import { formatAdvertiserLabel } from "~/lib/landing-page-display";
import type { CollectionItemRecord } from "~/lib/types";

/**
 * The selected saved record in the v4 detail pane.
 *
 * A stored capture is a record, not a new announcement, so it never spends
 * the page's green mark. Provenance remains explicit in words: captured by
 * Five to Nine, filed by the team, or sample data.
 */
// The kicker may only say a bare "Captured" when a capture time exists AND
// stored content backs it — an item missing either keeps the gap visible
// instead of dressing itself as a completed capture.
function savedItemKicker(input: {
  item: CollectionItemRecord;
  capturedAt: string | null;
  hasStoredContent: boolean;
}): string {
  const status = resolveSavedItemStatus(input.item.ad.source);
  if (status !== "Captured") return status;
  if (!input.capturedAt) return "Captured — time not recorded";
  if (!input.hasStoredContent) return "Captured — content not stored";
  return status;
}

export function SavedEvidenceItem({
  item,
  collectionName,
  editor,
}: {
  item: CollectionItemRecord;
  collectionName: string;
  /** The note/tag form and its remove control — supplied by the route. */
  editor?: ReactNode;
}) {
  const proofLink = savedItemProofLink(item);
  const plate = resolveSavedItemPlate(item.ad);
  const capturedAt = resolveSavedItemCapturedAt(item);
  const facts = buildSavedItemFacts(item).flatMap((row) => {
    const renderedRow = {
      key: row.key,
      value: row.value ?? row.missingLabel ?? "Not recorded",
    };
    return row.key === "Running" && capturedAt
      ? [
          {
            key: "Captured",
            value: <LocalTime iso={capturedAt} />,
          },
          renderedRow,
        ]
      : [renderedRow];
  });

  return (
    <>
      <DetailPaneHead
        name={formatAdvertiserLabel(item.ad.advertiser)}
        site={`${resolveSavedItemChannel(item.ad)} · ${collectionName}`}
      />
      <DetailBlock
        kicker={savedItemKicker({
          item,
          capturedAt,
          hasStoredContent:
            Boolean(item.ad.creativeImageUrl) || plate.captureLines.length > 0,
        })}
      >
        {plate.headline ? <h3 className="f9-library-detail-headline">{plate.headline}</h3> : null}
        {item.ad.creativeImageUrl ? (
          <div className="f9-library-detail-thumb">
            <AdThumb ad={item.ad} />
          </div>
        ) : null}
        {plate.captureLines.length > 0 ? (
          <blockquote className="f9-library-capture-copy">
            {plate.captureLines.map((line, index) => (
              <p key={index}>{line}</p>
            ))}
          </blockquote>
        ) : (
          <p className="f9-library-note">No readable copy was stored with this evidence.</p>
        )}
        <p className="f9-library-provenance">{savedItemFootnote(item)}</p>
        <div className="f9-wk-acts">
        {proofLink ? (
            <a className="f9-wk-lnk" href={proofLink} rel="noreferrer" target="_blank">
              Open evidence <span aria-hidden="true" className="f9-wk-chev">&rsaquo;</span>
            </a>
        ) : null}
        </div>
      </DetailBlock>
      <DetailBlock>
        <DetailFacts rows={facts} />
      </DetailBlock>
      {editor ? (
        <DetailBlock>
          <CollectionDisclosure
            className="f9-library-item-editor"
            group={COLLECTION_ITEM_GROUP}
            rank={3}
            summary="Edit note and tags"
          >
            {editor}
          </CollectionDisclosure>
        </DetailBlock>
      ) : null}
    </>
  );
}
