import type { ReactElement } from "react";

import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./ui/dialog";
import type { HowRanked, HowRankedBrand, HowRankedLine, HowRankedMultiplier, HowRankedWeight } from "../lib/how-ranked";

const HEADING_CLASS = "font-mono text-eyebrow text-ink-soft uppercase";
const ROW_CLASS = "border-line border-b py-2 font-mono last:border-b-0";
const LABEL_CLASS = "text-ink-soft";

function format(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function weightLabelFor(weights: readonly HowRankedWeight[], bucket: HowRankedLine["bucket"]): string {
  const match = weights.find((entry) => entry.key === bucket);
  if (match === undefined) throw new Error(`Missing weight label for bucket ${bucket}`);
  return match.label;
}

function multiplierLabelFor(
  multipliers: readonly HowRankedMultiplier[],
  reliability: HowRankedLine["reliability"],
): string {
  const match = multipliers.find((entry) => entry.reliability === reliability);
  if (match === undefined) throw new Error(`Missing multiplier label for reliability ${reliability}`);
  return match.label;
}

export function HowRankedTable({ howRanked }: { howRanked: HowRanked }): ReactElement {
  return (
    <section data-testid="how-ranked-table" className="font-mono">
      <h2 className={HEADING_CLASS}>How this is ranked</h2>
      <p className="text-ink-soft mt-2">
        Ranked by what the internet did about each brand this week.
      </p>

      <h3 className={HEADING_CLASS}>What each signal is worth</h3>
      <ul className="mt-2">
        {howRanked.weights.map((entry) => (
          <li key={entry.key} className={ROW_CLASS}>
            <span className={LABEL_CLASS}>{entry.label}</span>{" "}
            <span>{String(entry.weight)}</span>
          </li>
        ))}
      </ul>

      <h3 className={HEADING_CLASS}>How much each source counts</h3>
      <ul className="mt-2">
        {howRanked.multipliers.map((entry) => (
          <li key={entry.reliability} className={ROW_CLASS}>
            <span className={LABEL_CLASS}>{entry.label}</span>{" "}
            <span>×{String(entry.value)}</span>
          </li>
        ))}
      </ul>

      {howRanked.brands.map((brand) => (
        <BrandBlock
          brand={brand}
          key={brand.entityId}
          multipliers={howRanked.multipliers}
          weights={howRanked.weights}
        />
      ))}
    </section>
  );
}

function BrandBlock({
  brand,
  weights,
  multipliers,
}: {
  brand: HowRankedBrand;
  weights: readonly HowRankedWeight[];
  multipliers: readonly HowRankedMultiplier[];
}): ReactElement {
  const isEmpty = brand.lines.length === 0;
  return (
    <article className="border-line mt-4 border-t pt-3" data-testid="how-ranked-brand">
      <h4 className="font-display font-bold">{brand.name}</h4>
      <ul className="mt-1">
        {isEmpty && <li className={ROW_CLASS}>No signals this week</li>}
        {brand.lines.map((line) => (
          <li className={ROW_CLASS} key={`${line.bucket}-${line.reliability}`}>
            {`${String(line.n)} ${weightLabelFor(weights, line.bucket)} (${multiplierLabelFor(multipliers, line.reliability)}) × ${format(line.weight)} × ${format(line.multiplier)} = ${format(line.points)}`}
          </li>
        ))}
        <li className={ROW_CLASS}>{`Total ${isEmpty ? "—" : format(brand.total)}`}</li>
      </ul>
    </article>
  );
}

export function HowRankedSheet({ howRanked }: { howRanked: HowRanked }): ReactElement {
  return (
    <Dialog>
      <DialogTrigger
        render={<button type="button" />}
        className="text-ink-soft font-mono text-eyebrow uppercase underline underline-offset-4 min-h-11"
        title="ranked by what the internet did about each brand this week"
      >
        How this is ranked
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg max-[859px]:top-auto max-[859px]:bottom-0 max-[859px]:left-0 max-[859px]:max-w-none max-[859px]:translate-x-0 max-[859px]:translate-y-0 max-[859px]:rounded-b-none">
        <DialogTitle className="sr-only">How this is ranked</DialogTitle>
        <HowRankedTable howRanked={howRanked} />
      </DialogContent>
    </Dialog>
  );
}