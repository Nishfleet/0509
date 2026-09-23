import { useState } from "react";

import type { CardField } from "../lib/identity/card-types";

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
  transport,
  browserMsUsed,
  jevStatus,
}: {
  fields: CardField[];
  onEdit: (name: string, value: string) => void;
  transport: "fetch" | "browser" | null;
  browserMsUsed: number | null;
  jevStatus: "ok" | "unconfigured" | "unreachable";
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  return (
    <dl
      className="identity-card"
      data-transport={transport ?? "none"}
      data-browser-ms-used={browserMsUsed ?? "none"}
      data-jev={jevStatus}
    >
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
