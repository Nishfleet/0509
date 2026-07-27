import type { ReactNode } from "react";

import { AdThumb } from "~/components/ad-thumb";
import { CollectionDisclosure } from "~/components/collections/collection-disclosure";
import { EvidencePlate } from "~/components/evidence/evidence-plate";
import { SecondaryAction } from "~/components/evidence/cta";
import {
  buildSavedItemFacts,
  resolveSavedItemChannel,
  resolveSavedItemPlate,
  resolveSavedItemVerification,
  savedItemFootnote,
  savedItemProofLink,
} from "~/lib/collections-display";
import type { CollectionItemRecord } from "~/lib/types";

/**
 * One saved item, rendered as the brief's evidence plate — §6.9.
 *
 * This is the IA inversion in one component: the thing the customer saved is
 * the surface, numbered and stamped like a report plate, with the note/tag
 * editor demoted to a Rank-2 disclosure underneath instead of a permanently
 * open two-field form on every card (the old card-in-card stack that produced
 * the audit's overlapping "Remove from collection" control).
 *
 * The plate keeps its own border; the wrapper owns the rule and the action
 * row so the controls can never sit outside the card they belong to.
 */
export function SavedEvidenceItem({
  item,
  number,
  editor,
}: {
  item: CollectionItemRecord;
  /** Sequential across the collection; printed as 01, 02, … (§6.9). */
  number: number;
  /** The note/tag form and its remove control — supplied by the route. */
  editor?: ReactNode;
}) {
  const proofLink = savedItemProofLink(item);
  const plate = resolveSavedItemPlate(item.ad);

  return (
    <article className="f9-ed-collection-item">
      <EvidencePlate
        capture={item.ad.creativeImageUrl ? <AdThumb ad={item.ad} /> : undefined}
        captureLines={plate.captureLines}
        capturedAt={item.ad.evidenceCapturedAt ?? item.createdAt}
        facts={buildSavedItemFacts(item)}
        footnote={savedItemFootnote(item)}
        headingLevel={3}
        headline={plate.headline}
        number={number}
        title={resolveSavedItemChannel(item.ad)}
        verification={resolveSavedItemVerification(item.ad.source)}
      />
      <div className="f9-ed-collection-item-actions">
        {proofLink ? (
          <SecondaryAction href={proofLink} rel="noreferrer" small target="_blank">
            Open evidence
          </SecondaryAction>
        ) : null}
        {editor ? (
          <CollectionDisclosure
            className="f9-ed-collection-item-editor"
            rank={3}
            summary="Edit note and tags"
          >
            {editor}
          </CollectionDisclosure>
        ) : null}
      </div>
    </article>
  );
}
