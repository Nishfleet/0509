import type { NoulQuestion } from "./jev/client.server";

export const D4_QUESTION_ID = "read_this_first";

export const UNJUDGED_WEEK_LINE = "We couldn't judge this week's changes yet.";

/**
 * The weekly "read this first" question and the state it is judged on.
 *
 * They live here, not in the standing worker, because that worker imports
 * `cloudflare:workers` and the held-out evals in tests/evals run in node.
 * Moving the text is what lets `tests/evals/read-this-first.eval.test.ts`
 * judge the shipped wording instead of a copy of it (0509#6163).
 */

export const READ_THIS_FIRST: NoulQuestion = {
  id: D4_QUESTION_ID,
  instructions:
    "Does this item belong in the three things this brand's owner should read first this week? It is about `subject`, a company the owner watches.",
  whenTrue:
    "It reports a move a competitor made that the owner would act on or bring up this week: a launch, a price or offer change, funding, a deal, an acquisition, a top hire or exit, an expansion, a campaign, a controversy, or a big review.",
  whenFalse:
    "It is routine or background: a small site or copy tweak, a minor hire, a low-reach ad variant, a passing or listicle mention, old news retold, or a routine content update.",
};

/** One located signal: the week's item plus the entity it belongs to. */
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
  return `${String(picked)} of ${String(judged)} worth knowing this week, led by ${leadName}.`;
}
