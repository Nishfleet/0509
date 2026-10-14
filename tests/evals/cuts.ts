export interface CutSample {
  kind: string;
  label: boolean;
  p: number;
}

export interface KindCut {
  kind: string;
  samples: number;
  noteworthy: number;
  cut: number | null;
  precision: number | null;
  recall: number | null;
  shippedActs: number;
  shippedPrecision: number | null;
}

const MIN_PER_KIND = 5;

const PRECISION_WEIGHT = 0.5;

const SHIPPED_CUT = 0.9;

const SHIPPED_PRICING_CUT = 0.6;

function ratio(top: number, bottom: number): number | null {
  return bottom === 0 ? null : Number((top / bottom).toFixed(3));
}

function fScore(precision: number, recall: number): number {
  const beta = PRECISION_WEIGHT ** 2;
  const denominator = beta * precision + recall;
  return denominator === 0 ? 0 : ((1 + beta) * precision * recall) / denominator;
}

function acting(samples: readonly CutSample[], cut: number) {
  const acted = samples.filter((sample) => sample.p >= cut);
  return { acted: acted.length, right: acted.filter((sample) => sample.label).length };
}

function bestCut(samples: readonly CutSample[], noteworthy: number): number | null {
  const candidates = [...new Set(samples.map((sample) => sample.p))].sort((a, b) => b - a);
  const scored = candidates.map((cut) => {
    const { acted, right } = acting(samples, cut);
    const precision = acted === 0 ? 0 : right / acted;
    const recall = noteworthy === 0 ? 0 : right / noteworthy;
    return { cut, score: fScore(precision, recall) };
  });
  const best = scored.reduce<{ cut: number; score: number } | null>(
    (top, entry) => (top === null || entry.score > top.score ? entry : top),
    null,
  );
  return best === null || best.score === 0 ? null : best.cut;
}

function oneKind(kind: string, samples: readonly CutSample[]): KindCut {
  const noteworthy = samples.filter((sample) => sample.label).length;
  const shipped = kind === "pricing" ? SHIPPED_PRICING_CUT : SHIPPED_CUT;
  const shippedActed = acting(samples, shipped);
  const enough = samples.length >= MIN_PER_KIND;
  const cut = enough ? bestCut(samples, noteworthy) : null;
  const chosen = cut === null ? { acted: 0, right: 0 } : acting(samples, cut);
  return {
    kind,
    samples: samples.length,
    noteworthy,
    cut,
    precision: ratio(chosen.right, chosen.acted),
    recall: ratio(chosen.right, noteworthy),
    shippedActs: shippedActed.acted,
    shippedPrecision: ratio(shippedActed.right, shippedActed.acted),
  };
}

export function kindCuts(samples: readonly CutSample[]): KindCut[] {
  const kinds = [...new Set(samples.map((sample) => sample.kind))].sort();
  return kinds.map((kind) =>
    oneKind(
      kind,
      samples.filter((sample) => sample.kind === kind),
    ),
  );
}

function cell(value: number | null): string {
  return value === null ? "-" : String(value);
}

export function formatCuts(cuts: readonly KindCut[]): string {
  const rows = cuts.map(
    (entry) =>
      `${entry.kind}\tn ${entry.samples}\tnoteworthy ${entry.noteworthy}\tcut ${cell(entry.cut)}\tprecision ${cell(entry.precision)}\trecall ${cell(entry.recall)}\tshipped acts ${entry.shippedActs}\tshipped precision ${cell(entry.shippedPrecision)}`,
  );
  return ["per predicted kind: best cut by F0.5 (a wrong alert costs more than a missed one)", ...rows].join("\n");
}
