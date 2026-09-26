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
] as const;

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
        {TABS.map((tab) => {
          const active = selected === tab.kind;
          const label = `${tab.label} ${String(counts.get(tab.kind) ?? 0)}`;
          return (
            <button
              key={tab.kind}
              type="button"
              role="tab"
              id={`${panelId}-${tab.kind}`}
              aria-controls={panelId}
              aria-selected={active}
              onClick={() => {
                setSelected(tab.kind);
              }}
              className={cn(
                "border-line min-h-11 border px-2 py-1 font-mono text-eyebrow uppercase focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ink",
                active ? "bg-green-wash text-ink" : "text-ink-soft",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={panelId} aria-labelledby={`${panelId}-${selected}`} className="pt-2">
        {rows.length === 0 ? (
          <p className="text-ink-soft text-[0.88rem]">Nothing this week.</p>
        ) : (
          <ul className="flex min-w-0 flex-col gap-3">
            {rows.map((item) => {
              const image = item.evidenceUrl === null ? null : httpUrl(item.evidenceUrl);
              const href = item.url === null ? null : httpUrl(item.url);
              return (
                <li key={item.id} data-slot="evidence-row" className="flex min-w-0 items-start gap-3">
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
                    <span className="text-ink-soft block font-mono text-eyebrow">
                      {shortUtc(item.observedAt)}
                    </span>
                    {href === null ? null : (
                      <a href={href} target="_blank" rel="noreferrer" className="text-[0.88rem] underline">
                        Source
                      </a>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
