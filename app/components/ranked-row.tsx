import type { ReactElement } from "react";
import { useSearchParams } from "react-router";

import { BrandSwitch } from "./brand-switch";
import { brandMonogram } from "./brand-chip";
import { CapturePlate } from "./capture-plate";
import { Mark } from "./mark";
import { RowEvidence } from "./row-evidence";
import type { HomePill, HomeRow, WeekEvidence } from "../lib/home-standing";
import type { SiteChangeView } from "../lib/site-change";
import { cn } from "../lib/utils";

const PILL = "border-line border px-2 py-1 font-mono text-eyebrow uppercase";

export function RankedRow({
  row,
  onSwitch,
  openId,
  evidence,
}: {
  row: HomeRow;
  onSwitch?: (entityId: string, checked: boolean) => void;
  openId: string | null;
  evidence: readonly WeekEvidence[] | null;
}): ReactElement {
  const [, setSearchParams] = useSearchParams();
  const isOpen = openId === row.entityId;
  return (
    <li
      data-testid="standing-row"
      data-self={row.self ? "true" : undefined}
      data-open={isOpen ? "true" : undefined}
      className={cn(
        "border-line grid grid-cols-[2.25rem_26px_minmax(0,1fr)_auto_auto] items-center gap-3 border-b px-2 py-3",
        row.self && "bg-green-wash",
        isOpen && "border-l-4 border-l-green",
      )}
    >
      <span className="font-mono text-[0.88rem]">{positionLabel(row)}</span>
      <span
        aria-hidden="true"
        className={cn(
          "font-display flex size-[26px] items-center justify-center border-[1.5px] border-ink text-[0.8rem] font-extrabold",
          row.self ? "bg-green" : "bg-card",
        )}
      >
        {brandMonogram(row.name)}
      </span>
      <span className="min-w-0">
        <button
          type="button"
          data-slot="row-toggle"
          aria-expanded={isOpen}
          aria-controls={isOpen ? `evidence-${row.entityId}` : undefined}
          onClick={() => {
            setSearchParams(
              (prev) => {
                const next = new URLSearchParams(prev);
                if (isOpen) next.delete("open");
                else next.set("open", row.entityId);
                return next;
              },
              { replace: true, preventScrollReset: true },
            );
          }}
          className="block min-h-11 w-full min-w-0 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ink"
        >
          <span className="font-display text-row-name block truncate font-bold">{row.name}</span>
          {row.domain === null ? null : (
            <span className="text-ink-soft block truncate text-[0.88rem]">{row.domain}</span>
          )}
        </button>
        <span className="sr-only" role="status">
          {row.name} {isOpen ? "expanded" : "collapsed"}
        </span>
      </span>
      <span className="text-ink-soft text-right font-mono text-eyebrow uppercase">{row.movement}</span>
      <BrandSwitch
        state={row.self ? "you" : "on"}
        brandName={row.name}
        onCheckedChange={(checked) => onSwitch?.(row.entityId, checked)}
      />
      {row.move === null ? null : <RowMove move={row.move} />}
      {row.why === null ? null : (
        <p data-slot="row-why" className="col-span-full text-[0.88rem] leading-[1.5] text-ink-soft">
          Why it moved: {row.why}
        </p>
      )}
      <ul data-slot="row-pills" className="col-span-full flex min-w-0 flex-wrap gap-2">
        {row.pills.map((pill) => (
          <li
            key={pill.key}
            data-state={pill.state}
            className={cn(PILL, "text-ink-soft", pill.state === "live" ? "border-solid" : "border-dashed")}
          >
            {pillText(pill)}
          </li>
        ))}
      </ul>
      {isOpen ? (
        <div
          id={`evidence-${row.entityId}`}
          data-slot="row-evidence"
          className="col-span-full max-[859px]:hidden"
        >
          {evidence === null ? null : <RowEvidence evidence={evidence} />}
        </div>
      ) : null}
    </li>
  );
}

function RowMove({ move }: { move: SiteChangeView }): ReactElement | null {
  const removed = move.mark?.removed ?? null;
  const added = move.mark?.added ?? null;
  if (removed === null || added === null) return null;
  return (
    <div data-slot="row-move" className="col-span-full">
      <Mark
        before={removed}
        after={added}
        sourceUrl={move.url}
        capturedAt={move.capturedAt}
        size="sm"
        capture={<CapturePlate label={move.headline} before={move.before} after={move.after} />}
      />
    </div>
  );
}

function positionLabel(row: HomeRow): string {
  if (row.signals === 0 || row.position === null) return "—";
  return `#${String(row.position)}`;
}

function pillText(pill: HomePill): string {
  if (pill.state === "live") return `${pill.label} · ${String(pill.count)}`;
  if (pill.state === "degraded") return `${pill.label} — degraded`;
  return `${pill.label} — none`;
}
