import { useState } from "react";

import type { CardField } from "../lib/identity/card.server";

// The card is the form: every field is editable in place, fields Jev was
// unsure about are outlined "check this", and an empty field says what will
// fill it — never a spinner in place of a field (REBUILD-ONBOARDING.md).

const FILLER: Record<string, string> = {
  name: "we'll fill this after the first crawl",
  logo: "looking on the site and icon services",
  description: "we'll fill this after the first crawl",
  category: "we'll fill this after the first crawl",
  country: "we'll fill this after the first crawl",
  socials: "we'll find these on the first crawl",
  pricing_page: "we'll find this on the first crawl, within the hour",
};

export function IdentityCardFields({
  fields,
  onEdit,
}: {
  fields: CardField[];
  onEdit: (name: string, value: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  return (
    <dl className="identity-card">
      {fields.map((f) => (
        <div key={f.name} data-state={f.state}>
          <dt>{f.name.replace("_", " ")}</dt>
          <dd>
            {editing === f.name ? (
              <span>
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => { setDraft(e.target.value); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      onEdit(f.name, draft);
                      setEditing(null);
                    }
                    if (e.key === "Escape") setEditing(null);
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    onEdit(f.name, draft);
                    setEditing(null);
                  }}
                >
                  Save
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setEditing(f.name);
                  setDraft(f.value ?? "");
                }}
              >
                {f.value ?? FILLER[f.name] ?? "we'll fill this after the first crawl"}
                {f.state === "check" ? " — check this" : null}
              </button>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
