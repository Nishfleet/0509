import { Form } from "react-router";
import type { ReactNode } from "react";

import {
  COLLECTION_PANEL_GROUP,
  CollectionDisclosure,
} from "~/components/collections/collection-disclosure";
import { SubmitButton } from "~/components/submit-button";
import { COLLECTION_BOARD_EMPTY_COPY, RESERVED_COLLECTION_SLOT_COPY } from "~/lib/collections-display";

/**
 * Creating a collection — brief §7 (the collections IA inversion) and §6.8.
 *
 * Two modes, one form:
 *
 * - `first-run` — there are no collections yet, so the quiet explanation and
 *   form ARE the page. The form owns the screen's single Rank-1 submit.
 * - `disclosure` — collections exist, so saved evidence owns the page and
 *   creating another one is a Rank-2 action that reveals a panel (§7), with a
 *   Rank-2 submit. The screen's Rank-1 budget stays free.
 */
export function CollectionCreatePanel({
  mode,
  feedback,
  defaultOpen = false,
}: {
  mode: "first-run" | "disclosure";
  /** Inline action feedback for the create intent, rendered inside the form. */
  feedback?: ReactNode;
  /** Opens the form when the header's New collection command is followed. */
  defaultOpen?: boolean;
}) {
  const fields = (
    <Form className="f9-library-form" method="post">
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
        className={mode === "first-run" ? "f9-wk-btn" : "f9-wk-lnk"}
        intent="create-collection"
        pendingLabel="Creating…"
      >
        Create collection
      </SubmitButton>
    </Form>
  );

  if (mode === "disclosure") {
    return (
      <CollectionDisclosure
        className="f9-library-create"
        defaultOpen={defaultOpen}
        group={COLLECTION_PANEL_GROUP}
        summary="New collection"
      >
        {fields}
      </CollectionDisclosure>
    );
  }

  return (
    <section aria-labelledby="collections-first-title" className="f9-wk-sec f9-library-empty">
      <p className="f9-wk-kick">Nothing filed yet</p>
      <h2 className="f9-library-section-title" id="collections-first-title">
        Start your first collection
      </h2>
      <p className="f9-wk-lede">{COLLECTION_BOARD_EMPTY_COPY}</p>
      <p className="f9-library-note">{RESERVED_COLLECTION_SLOT_COPY}</p>
      {fields}
    </section>
  );
}
