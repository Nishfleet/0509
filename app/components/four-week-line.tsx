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

  return (
    <>
      <figure data-chart="four-week" className="relative h-[180px]">
        <div ref={setFrame} className="absolute inset-0">
          {mounted && width > 0 ? (
            <Suspense fallback={null}>
              <FourWeekPlot chart={chart} width={width} />
            </Suspense>
          ) : null}
        </div>
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
