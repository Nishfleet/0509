import type { ReactElement } from "react";
import { lazy, Suspense, useCallback, useState, useSyncExternalStore } from "react";

import type { FourWeekChart } from "../lib/home-standing";

const FourWeekPlot = lazy(() => import("./four-week-plot").then((m) => ({ default: m.FourWeekPlot })));

function subscribeToNothing(): () => void {
  return () => undefined;
}

function mountedInBrowser(): boolean {
  return true;
}

function notMountedOnServer(): boolean {
  return false;
}

function useWidth(element: HTMLElement | null): number {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (element === null) return subscribeToNothing;
      const observer = new ResizeObserver(onChange);
      observer.observe(element);
      return () => {
        observer.disconnect();
      };
    },
    [element],
  );
  return useSyncExternalStore(subscribe, () => element?.clientWidth ?? 0, () => 0);
}

export function FourWeekLine({ chart }: { chart: FourWeekChart }): ReactElement {
  const mounted = useSyncExternalStore(subscribeToNothing, mountedInBrowser, notMountedOnServer);
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const width = useWidth(frame);

  const caption = chart.weeks.length === 1 ? "Four-week ranks, first week" : "Four-week ranks";
  return (
    <>
      <figure data-chart="four-week">
        <div className="relative h-[180px]" aria-hidden="true">
          <div ref={setFrame} className="absolute inset-0">
            {mounted && width > 0 ? (
              <Suspense fallback={null}>
                <FourWeekPlot chart={chart} width={width} />
              </Suspense>
            ) : null}
          </div>
        </div>
        <table className="sr-only">
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Brand</th>
              {chart.weeks.map((week, index) => (
                <th key={`${week}-${String(index)}`} scope="col">
                  {week}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chart.lines.map((line) => (
              <tr key={line.entityId}>
                <th scope="row">
                  {line.label}
                  {line.paused ? " paused" : ""}
                </th>
                {line.ranks.map((rank, index) => (
                  <td key={`${line.entityId}-${String(index)}`}>{rank === null ? "none" : String(rank)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </figure>
      <ol aria-hidden="true" className="flex justify-between font-mono text-eyebrow text-ink-soft uppercase">
        {chart.weeks.map((week, index) => (
          <li key={`${week}-${String(index)}`}>{week}</li>
        ))}
      </ol>
      {chart.weeks.length === 1 ? (
        <p className="font-mono text-eyebrow text-ink-soft uppercase">first week</p>
      ) : null}
    </>
  );
}
