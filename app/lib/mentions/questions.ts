import type { NoulQuestion } from "../jev/client.server";
import { MENTION_MATTERS_WHEN_FALSE, MENTION_MATTERS_WHEN_TRUE } from "./reason-customer";

/**
 * The two mention questions and the exact state each one is judged on.
 *
 * They live here, not in the sweep worker, because the sweep worker imports
 * `cloudflare:workers` and the held-out evals in tests/evals run in node.
 * Moving the text is what lets `tests/evals/mentions.eval.test.ts` judge the
 * shipped wording instead of a copy of it: the worker asks these constants
 * through these builders, so a wording edit and its eval move together
 * (0509#6163).
 */

export const ABOUT_BRAND: NoulQuestion = {
  id: "mention_is_about_brand",
  instructions:
    "Is `item` actually about `subject`, the brand named in `subject.name` with the website `subject.domain`, and not a different company, product, person or word that shares the name?",
  whenTrue: "The headline is about this brand or its products, people or business.",
  whenFalse: "It is about something else that shares or resembles the name.",
};

export const MATTERS: NoulQuestion = {
  id: "mention_matters",
  instructions:
    "Would the owner of `self` want to know about this mention of `subject` this week? It matters when it shows a move: a launch, a price or offer change, funding, a deal, a hire or exit at the top, an expansion, a campaign, a controversy or a big review.",
  whenTrue: MENTION_MATTERS_WHEN_TRUE,
  whenFalse: MENTION_MATTERS_WHEN_FALSE,
};

/** The watch row fields the two questions are asked about. */
export interface MentionSubject {
  name: string;
  domain: string;
  role: string;
}

/** The judged mention item, as the sweep carries it before it hits D1. */
export interface MentionItemInput {
  title: string;
  url: string;
  publishedAt: string | null;
  publisher?: string | null;
}

/** The workspace brand, the "who is asking" half of `mention_matters`. */
export interface MentionSelf {
  name: string;
  domain: string;
  description: string | null;
}

export function mentionItemState(
  item: MentionItemInput,
  reliability: string,
): { title: string; publisher: string | null; url: string; published_at: string | null; reliability: string } {
  return {
    title: item.title,
    publisher: item.publisher ?? null,
    url: item.url,
    published_at: item.publishedAt,
    reliability,
  };
}

/** The state `mention_is_about_brand` is asked on. */
export function aboutBrandState(input: {
  subject: MentionSubject;
  item: MentionItemInput;
  reliability: string;
}): unknown {
  return {
    subject: { name: input.subject.name, domain: input.subject.domain, role: input.subject.role },
    item: mentionItemState(input.item, input.reliability),
  };
}

/** The state `mention_matters` is asked on. */
export function mentionMattersState(input: {
  self: MentionSelf;
  subject: MentionSubject;
  competitors: { name: string; domain: string }[];
  item: MentionItemInput;
  reliability: string;
}): unknown {
  return {
    self: { name: input.self.name, domain: input.self.domain, description: input.self.description },
    subject: { name: input.subject.name, domain: input.subject.domain, role: input.subject.role },
    competitor_set: input.competitors,
    item: mentionItemState(input.item, input.reliability),
  };
}
