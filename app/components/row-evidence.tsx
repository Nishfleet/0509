import { useId, useState } from "react";
import type { ReactElement } from "react";

import type { WeekEvidence } from "../lib/home-standing";
import { httpUrl } from "../lib/http-url";
import { shortUtc } from "../lib/short-utc";
import { cn } from "../lib/utils";

const TABS = [
  { kind: "site", label: "Site changes" },
  { kind: "ads", label: "Ads" },
  { kind: "mentions", label: "Mentions" },
  { kind: "hiring", label: "Hiring" },
  { kind: "content", label: "Blog posts" },
] as const;

interface EvidenceTabProps {
  kind: string;
  label: string;
  active: boolean;
  panelId: string;
  onSelect: (kind: string) => void;
}

function EvidenceTab({ kind, label, active, panelId, onSelect }: EvidenceTabProps): ReactElement {
  return (
    <button
      type="button"
      role="tab"
      id={`${panelId}-${kind}`}
      aria-controls={panelId}
      aria-selected={active}
      onClick={() => {
        onSelect(kind);
      }}
      className={cn(
        "min-h-11 border border-line px-2 py-1 font-mono text-eyebrow uppercase focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink focus-visible:outline-solid",
        active ? "bg-green-wash text-ink" : "text-ink-soft",
      )}
    >
      {label}
    </button>
  );
}

function EvidenceItem({ item }: { item: WeekEvidence }): ReactElement {
  const image = item.evidenceUrl === null ? null : httpUrl(item.evidenceUrl);
  const href = item.url === null ? null : httpUrl(item.url);
  return (
    <li data-slot="evidence-row" className="flex min-w-0 items-start gap-3">
      {image === null ? null : (
        <img
          src={image}
          loading="lazy"
          alt=""
          className="h-[74px] w-[104px] object-cover object-top max-[859px]:h-14 max-[859px]:w-[76px]"
        />
      )}
      <span className="min-w-0">
        <span className="block truncate">{item.title ?? item.summary ?? "Untitled"}</span>
        <span className="block font-mono text-eyebrow text-ink-soft">{shortUtc(item.observedAt)}</span>
        {href === null ? null : (
          <a href={href} target="_blank" rel="noreferrer" className="text-[0.88rem] underline">
            Source
          </a>
        )}
      </span>
    </li>
  );
}

export function RowEvidence({ evidence }: { evidence: readonly WeekEvidence[] }): ReactElement {
  const counts = new Map<string, number>();
  for (const item of evidence) counts.set(item.sourceKind, (counts.get(item.sourceKind) ?? 0) + 1);
  const [selected, setSelected] = useState<string>(
    () => TABS.find((tab) => (counts.get(tab.kind) ?? 0) > 0)?.kind ?? "site",
  );
  const rows = evidence.filter((item) => item.sourceKind === selected);
  const panelId = useId();
  return (
    <div className="pt-2">
      <div role="tablist" aria-label="This week's evidence" className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <EvidenceTab
            key={tab.kind}
            kind={tab.kind}
            label={`${tab.label} ${String(counts.get(tab.kind) ?? 0)}`}
            active={selected === tab.kind}
            panelId={panelId}
            onSelect={setSelected}
          />
        ))}
      </div>
      <div role="tabpanel" id={panelId} aria-labelledby={`${panelId}-${selected}`} className="pt-2">
        {rows.length === 0 ? (
          <p className="text-[0.88rem] text-ink-soft">Nothing this week.</p>
        ) : (
          <ul className="flex min-w-0 flex-col gap-3">
            {rows.map((item) => (
              <EvidenceItem key={item.id} item={item} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
