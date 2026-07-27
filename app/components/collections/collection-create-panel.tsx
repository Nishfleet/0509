import { Form } from "react-router";
import type { ReactNode } from "react";

import { CollectionDisclosure } from "~/components/collections/collection-disclosure";
import { SubmitButton } from "~/components/submit-button";
import { COLLECTION_BOARD_EMPTY_COPY, RESERVED_COLLECTION_SLOT_COPY } from "~/lib/collections-display";

/**
 * Creating a collection — brief §7 (the collections IA inversion) and §6.8.
 *
 * Two modes, one form:
 *
 * - `first-run` — there are no collections yet, so there is no saved evidence
 *   to put first. The form IS the page, rendered as the brief's specimen panel:
 *   ink header stating the real state, a headline and one honest paragraph,
 *   the form with the screen's single Rank-1 submit, and a numbered reserved
 *   slot so the state reads as *reserved*, not broken. Exactly one empty panel
 *   on the screen — never a grid of them (A2) and never a mascot in a void (A3).
 * - `disclosure` — collections exist, so saved evidence owns the page and
 *   creating another one is a Rank-2 action that reveals a panel (§7), with a
 *   Rank-2 submit. The screen's Rank-1 budget stays free.
 */
export function CollectionCreatePanel({
  mode,
  feedback,
}: {
  mode: "first-run" | "disclosure";
  /** Inline action feedback for the create intent, rendered inside the form. */
  feedback?: ReactNode;
}) {
  const submitRank = mode === "first-run" ? 1 : 2;
  const fields = (
    <Form className="f9-ed-form" method="post">
      <input name="intent" type="hidden" value="create-collection" />
      <label className="f9-field">
        <span>Name</span>
        <input name="name" placeholder="Competitor set A" required />
      </label>
      <label className="f9-field">
        <span>Description</span>
        <textarea name="description" placeholder="Optional context for the team" rows={2} />
      </label>
      {feedback}
      <SubmitButton
        className={`f9-ed-cta f9-ed-cta--rank${submitRank}`}
        intent="create-collection"
        pendingLabel="Creating…"
      >
        Create collection
      </SubmitButton>
    </Form>
  );

  if (mode === "disclosure") {
    return (
      <CollectionDisclosure className="f9-ed-collection-create" summary="New collection">
        {fields}
      </CollectionDisclosure>
    );
  }

  return (
    <section className="f9-ed-specimen f9-ed-collection-create">
      <header className="f9-ed-plate-header f9-ed-micro">
        <span>Collections · none yet</span>
      </header>
      <div className="f9-ed-specimen-body">
        <h2 className="f9-ed-specimen-headline">Start your first collection</h2>
        <p className="f9-ed-specimen-copy">{COLLECTION_BOARD_EMPTY_COPY}</p>
        {fields}
        <div className="f9-ed-specimen-slot">
          <div aria-hidden="true" className="f9-ed-specimen-scan" />
          <div className="f9-ed-specimen-slot-header f9-ed-micro">Plate 01 — reserved</div>
          {/* A description of what lands here, not content: out of the
              accessibility tree and out of the tab order. */}
          <div aria-hidden="true" className="f9-ed-specimen-slot-inner" inert>
            <p className="f9-ed-specimen-copy">{RESERVED_COLLECTION_SLOT_COPY}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
