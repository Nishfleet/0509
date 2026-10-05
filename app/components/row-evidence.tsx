import type { ReactElement } from "react";

import type { WeekEvidence } from "../lib/home-standing";
import { httpUrl } from "../lib/http-url";
import { shortUtc } from "../lib/short-utc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

const TABS = [
  { kind: "site", label: "Site changes" },
  { kind: "ads", label: "Ads" },
  { kind: "mentions", label: "Mentions" },
  { kind: "hiring", label: "Hiring" },
  { kind: "content", label: "Blog posts" },
] as const;

function EvidenceItem({ item }: { item: WeekEvidence }): ReactElement {
  const image = item.evidenceUrl === null ? null : httpUrl(item.evidenceUrl);
  const href = item.url === null ? null : httpUrl(item.url);
  const label = item.title ?? item.summary ?? "Untitled";
  return (
    <li data-slot="evidence-row" className="flex min-w-0 items-start gap-3">
      {image === null ? null : (
        <img
          src={image}
          width={104}
          height={74}
          loading="lazy"
          alt=""
          className="h-[74px] w-[104px] object-cover object-top max-[859px]:h-14 max-[859px]:w-[76px]"
        />
      )}
      <span className="min-w-0">
        <span className="block truncate">{label}</span>
        <span className="block font-mono text-eyebrow text-ink-soft">{shortUtc(item.observedAt)}</span>
        {href === null ? null : (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            aria-label={`Source: ${label} (opens in a new tab)`}
            className="inline-flex min-h-11 items-center text-[0.88rem] underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink focus-visible:outline-solid"
          >
            Source
          </a>
        )}
      </span>
    </li>
  );
}

function EvidencePanel({ rows }: { rows: readonly WeekEvidence[] }): ReactElement {
  if (rows.length === 0) {
    return <p className="text-[0.88rem] text-ink-soft">Nothing this week.</p>;
  }
  return (
    <ul className="flex min-w-0 flex-col gap-3">
      {rows.map((item) => (
        <EvidenceItem key={item.id} item={item} />
      ))}
    </ul>
  );
}

export function RowEvidence({ evidence }: { evidence: readonly WeekEvidence[] }): ReactElement {
  const counts = new Map<string, number>();
  for (const item of evidence) counts.set(item.sourceKind, (counts.get(item.sourceKind) ?? 0) + 1);
  const selected = TABS.find((tab) => (counts.get(tab.kind) ?? 0) > 0)?.kind ?? "site";
  return (
    <Tabs defaultValue={selected} className="pt-2">
      <TabsList
        aria-label="This week's evidence"
        className="flex h-auto flex-wrap gap-2 rounded-none bg-transparent p-0"
      >
        {TABS.map((tab) => (
          <TabsTrigger
            key={tab.kind}
            value={tab.kind}
            className="min-h-11 flex-none rounded-none border border-line px-2 py-1 font-mono text-eyebrow text-ink-soft uppercase focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink focus-visible:outline-solid data-active:bg-green-wash data-active:text-ink"
          >
            {`${tab.label} ${String(counts.get(tab.kind) ?? 0)}`}
          </TabsTrigger>
        ))}
      </TabsList>
      {TABS.map((tab) => (
        <TabsContent key={tab.kind} value={tab.kind} className="pt-2">
          <EvidencePanel rows={evidence.filter((item) => item.sourceKind === tab.kind)} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
