import { useEffect, useState, type ComponentType } from "react";
import type uPlot from "uplot";

import { formatScore } from "../lib/standing-present";

import "uplot/dist/uPlot.min.css";

type ChartImpl = ComponentType<{ options: uPlot.Options; data: uPlot.AlignedData }>;

export function FourWeekLine({
  weeks,
  series,
}: {
  weeks: string[];
  series: { entityId: string; name: string; scores: (number | null)[] }[];
}) {
  const [Chart, setChart] = useState<ChartImpl | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("uplot-react").then((mod) => {
      if (!cancelled) setChart(() => mod.default);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (weeks.length === 0) return null;
  const xs = weeks.map((_, index) => index);
  const data = [xs, ...series.map((line) => line.scores)] as uPlot.AlignedData;
  const options: uPlot.Options = {
    width: 300,
    height: 160,
    series: [{}, ...series.map((line) => ({ label: line.name, stroke: "#1d4e89" }))],
    axes: [{}, { show: true }],
  };

  return (
    <figure className="max-w-full">
      <figcaption>Four weeks</figcaption>
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr>
            <th className="text-left">Brand</th>
            {weeks.map((week) => (
              <th key={week}>{week}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {series.map((line) => (
            <tr key={line.entityId}>
              <th className="truncate text-left">{line.name}</th>
              {line.scores.map((score, index) => (
                <td key={weeks[index] ?? String(index)}>{score === null ? "·" : formatScore(score)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {Chart ? <Chart options={options} data={data} /> : null}
    </figure>
  );
}
