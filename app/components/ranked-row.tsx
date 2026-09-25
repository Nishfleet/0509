import type { ReactElement } from "react";
import { Link } from "react-router";

import { BrandSwitch } from "./brand-switch";
import { brandMonogram } from "./brand-chip";
import type { HomePill, HomeRow } from "../lib/home-standing";
import { cn } from "../lib/utils";

const PILL = "border-line border px-2 py-1 font-mono text-eyebrow uppercase";

export function RankedRow({
  row,
  onSwitch,
}: {
  row: HomeRow;
  onSwitch?: (entityId: string, checked: boolean) => void;
}): ReactElement {
  return (
    <li
      data-testid="standing-row"
      data-self={row.self ? "true" : undefined}
      className={cn(
        "border-line grid grid-cols-[2.25rem_26px_minmax(0,1fr)_auto_auto] items-center gap-3 border-b px-2 py-3",
        row.self && "bg-green-wash",
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
        {row.self ? (
          <span className="font-display text-row-name block truncate font-bold">{row.name}</span>
        ) : (
          <Link
            to={`/app/competitors/${row.entityId}`}
            prefetch="intent"
            className="font-display text-row-name block truncate font-bold hover:underline"
          >
            {row.name}
          </Link>
        )}
        {row.domain === null ? null : (
          <span className="text-ink-soft block truncate text-[0.88rem]">{row.domain}</span>
        )}
      </span>
      <span className="text-ink-soft text-right font-mono text-eyebrow uppercase">{row.movement}</span>
      <BrandSwitch
        state={row.self ? "you" : "on"}
        brandName={row.name}
        onCheckedChange={(checked) => onSwitch?.(row.entityId, checked)}
      />
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
            className={cn(PILL, pill.state === "live" ? "text-ink-soft" : "text-ink-faint")}
          >
            {pillText(pill)}
          </li>
        ))}
      </ul>
    </li>
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
