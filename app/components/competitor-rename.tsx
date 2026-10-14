import type { ReactElement } from "react";
import { Form, useNavigation } from "react-router";

import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { NAME_MAX } from "../lib/competitor-name";

const HEADING = "mb-3 font-mono text-eyebrow text-ink-soft uppercase";

export interface CompetitorRenameProps {
  name: string;
  domain: string;
  result: { nameError: string | null; renamed: boolean } | undefined;
}

function RenameNotice({ error, renamed }: { error: string | null; renamed: boolean }): ReactElement | null {
  if (error !== null) {
    return (
      <p id="competitor-rename-error" role="alert" className="text-[0.95rem]">
        {error}
      </p>
    );
  }
  return renamed ? (
    <p role="status" className="text-meta text-ink-soft">
      Saved.
    </p>
  ) : null;
}

export function CompetitorRename({ name, domain, result }: CompetitorRenameProps): ReactElement {
  const navigation = useNavigation();
  const error = result?.nameError ?? null;
  const renamed = result?.renamed === true;
  const saving = navigation.state !== "idle" && navigation.formData?.get("intent") === "rename";
  return (
    <section data-section="rename" aria-labelledby="competitor-rename" className="min-w-0">
      <h2 id="competitor-rename" className={HEADING}>
        Name
      </h2>
      <p className="text-meta text-ink-soft">
        Wrong name? Change how we show it. We keep watching {domain} either way.
      </p>
      <p className="text-meta text-ink-soft">{"We'll search for mentions under the new name from tonight."}</p>
      <Form method="post" className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="intent" value="rename" />
        <label htmlFor="competitor-rename-name" className="text-meta">
          Show this competitor as
        </label>
        <Input
          key={name}
          id="competitor-rename-name"
          name="name"
          type="text"
          defaultValue={name}
          autoComplete="off"
          enterKeyHint="done"
          required
          maxLength={NAME_MAX}
          aria-invalid={error === null ? undefined : true}
          aria-describedby={error === null ? undefined : "competitor-rename-error"}
        />
        <RenameNotice error={error} renamed={renamed} />
        <Button type="submit" variant="secondary" className="self-start" disabled={saving}>
          {saving ? "Saving…" : "Save name"}
        </Button>
      </Form>
    </section>
  );
}
