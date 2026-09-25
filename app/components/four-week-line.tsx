import type { ReactElement } from "react";
import { useSyncExternalStore } from "react";
import type { AlignedData, Options, Series } from "uplot";
import UplotReact from "uplot-react";

import "uplot/dist/uPlot.min.css";

import type { FourWeekChart } from "../lib/home-standing";

interface Tokens {
  ink: string;
  inkSoft: string;
  green: string;
}

function subscribeToNothing(): () => void {
  return () => undefined;
}

function mountedInBrowser(): boolean {
  return true;
}

function notMountedOnServer(): boolean {
  return false;
}

function tokens(): Tokens {
  const style = getComputedStyle(document.documentElement);
  return {
    ink: style.getPropertyValue("--ink").trim(),
    inkSoft: style.getPropertyValue("--ink-soft").trim(),
    green: style.getPropertyValue("--green").trim(),
  };
}

function lastRank(ranks: readonly (number | null)[]): number {
  for (let index = ranks.length - 1; index >= 0; index -= 1) {
    if (ranks[index] !== null) return index;
  }
  return -1;
}

export function FourWeekLine({ chart }: { chart: FourWeekChart }): ReactElement {
  const mounted = useSyncExternalStore(subscribeToNothing, mountedInBrowser, notMountedOnServer);

  return (
    <>
      <figure data-chart="four-week" className="relative h-[180px]">
        <div className="absolute inset-0">{mounted ? <FourWeekPlot chart={chart} /> : null}</div>
      </figure>
      <ol className="flex justify-between font-mono text-eyebrow text-ink-soft uppercase">
        {chart.weeks.map((week) => (
          <li key={week}>{week}</li>
        ))}
      </ol>
      {chart.weeks.length === 1 ? (
        <p className="font-mono text-eyebrow text-ink-soft uppercase">first week</p>
      ) : null}
      <ul className="sr-only">
        {chart.lines.map((line) => (
          <li key={line.entityId}>
            {line.label}
            {line.paused ? " paused" : ""}
          </li>
        ))}
      </ul>
    </>
  );
}

function FourWeekPlot({ chart }: { chart: FourWeekChart }): ReactElement {
  const color = tokens();
  const other: Series = { stroke: color.inkSoft, width: 1, spanGaps: false, points: { show: true } };
  const wide: Series = { stroke: color.green, width: 8, spanGaps: false, points: { show: false } };
  const thin: Series = { stroke: color.ink, width: 2, spanGaps: false, points: { show: true } };
  const series: Series[] = [{}, ...chart.lines.flatMap((line) => (line.self ? [wide, thin] : [other]))];
  const data: AlignedData = [
    chart.weeks.map((_week, index) => index),
    ...chart.lines.flatMap((line) => (line.self ? [[...line.ranks], [...line.ranks]] : [[...line.ranks]])),
  ];
  const options: Options = {
    width: 640,
    height: 180,
    legend: { show: false },
    cursor: { show: false },
    scales: { x: { time: false }, y: { dir: -1 } },
    axes: [{ show: false }, { show: false }],
    series,
    hooks: {
      draw: [
        (plot) => {
          plot.ctx.font = "12px ui-monospace, monospace";
          for (const line of chart.lines) {
            const index = lastRank(line.ranks);
            if (index < 0) continue;
            const rank = line.ranks[index];
            if (rank === null) continue;
            plot.ctx.fillStyle = line.self ? color.ink : color.inkSoft;
            plot.ctx.fillText(
              line.paused ? "paused" : line.label,
              plot.valToPos(index, "x", true) + 6,
              plot.valToPos(rank, "y", true),
            );
          }
        },
      ],
    },
  };
  return <UplotReact options={options} data={data} />;
}
