import type { ReactElement } from "react";
import { Form, useNavigation } from "react-router";

import { Button } from "./ui/button";
import { NOTE_MAX } from "../lib/entity-note";

const HEADING = "mb-3 font-mono text-eyebrow text-ink-soft uppercase";

export interface CompetitorNoteProps {
  note: string;
  error: string | null;
}

export function CompetitorNote({ note, error }: CompetitorNoteProps): ReactElement {
  const navigation = useNavigation();
  const saving = navigation.state !== "idle" && navigation.formData?.get("intent") === "note";
  return (
    <section data-section="note" aria-labelledby="competitor-note" className="min-w-0">
      <h2 id="competitor-note" className={HEADING}>
        Your notes
      </h2>
      <p className="text-meta text-ink-soft">
        Only people signed in to your workspace can see this. It is never emailed.
      </p>
      <Form method="post" className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="intent" value="note" />
        <label htmlFor="competitor-note-body" className="text-meta">
          What you know about them
        </label>
        <textarea
          id="competitor-note-body"
          name="note"
          rows={4}
          maxLength={NOTE_MAX}
          defaultValue={note}
          placeholder="They discount every Q4. Ask Sam about their enterprise tier."
          aria-invalid={error === null ? undefined : true}
          aria-describedby={error === null ? undefined : "competitor-note-error"}
          className="min-h-24 w-full border border-ink bg-transparent p-3 text-body"
        />
        {error === null ? null : (
          <p id="competitor-note-error" role="alert" className="text-[0.95rem]">
            {error}
          </p>
        )}
        <Button type="submit" variant="secondary" className="self-start" disabled={saving}>
          {saving ? "Saving…" : "Save note"}
        </Button>
      </Form>
    </section>
  );
}
