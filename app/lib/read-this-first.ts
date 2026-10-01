import type { NoulQuestion } from "./jev/thresholds";

export const D4_QUESTION_ID = "read_this_first";

export const UNJUDGED_WEEK_LINE = "We haven't finished reviewing this week's changes yet.";

export const READ_THIS_FIRST: NoulQuestion = {
  id: D4_QUESTION_ID,
  instructions: "Does this item belong in the three things this brand's owner should read first this week?",
  whenTrue: "It would change what the owner does or thinks about a competitor this week.",
  whenFalse: "It is routine and can wait for the full list.",
};

export interface ReadThisFirstItem {
  kind: string;
  title: string | null;
  summary: string | null;
  url: string | null;
  aspect: string | null;
  observed_at: string;
}

export interface ReadThisFirstEntity {
  id: string;
  role: string;
  name: string;
  domain: string;
}

export function readThisFirstState(input: {
  item: ReadThisFirstItem;
  itemEntityId: string;
  entity: ReadThisFirstEntity;
  self: { name: string; domain: string } | null;
  entities: readonly ReadThisFirstEntity[];
}): unknown {
  const competitorSet = input.entities
    .filter((entity) => entity.role === "competitor" && entity.id !== input.itemEntityId)
    .map((entity) => entity.domain);
  return {
    self: input.self,
    subject: { name: input.entity.name, domain: input.entity.domain },
    competitor_set: competitorSet,
    item: {
      kind: input.item.kind,
      title: input.item.title,
      summary: input.item.summary,
      url: input.item.url,
      aspect: input.item.aspect,
      observed_at: input.item.observed_at,
    },
  };
}

export interface D4Verdict {
  signalId: string;
  p: number;
  observedAt: string;
}

export function pickReadThisFirst(verdicts: readonly D4Verdict[]): string[] {
  return verdicts
    .filter((v) => v.p >= 0.5)
    .sort((a, b) => b.p - a.p || b.observedAt.localeCompare(a.observedAt))
    .slice(0, 3)
    .map((v) => v.signalId);
}

export function readThisFirstLine(picked: number, judged: number, leadName: string): string {
  return `${String(picked)} of ${String(judged)} changes worth reading this week, led by ${leadName}.`;
}
