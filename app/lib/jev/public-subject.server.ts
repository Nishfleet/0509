import { insertVerdict } from "../data/jev_verdict.server";
import type { Subject } from "../identity/normalise";
import type { NoulQuestion, NoulVerdict } from "./client.server";
import { askNoul } from "./client.server";
import type { NoulAction } from "./thresholds";
import { noulAction } from "./thresholds";

export const PUBLIC_SUBJECT: NoulQuestion = {
  id: "public_subject",
  instructions:
    "Does `item` (a domain, handle or channel) present itself to the public for commercial or audience reasons: a company, a brand, a product, or a creator publishing to an audience?",
  whenTrue: "It is a business, brand, product or public creator that presents itself to the public.",
  whenFalse:
    "It is a private individual: a personal name or personal handle with no sign of a company, brand, product, or creator publishing to an audience.",
};

export type PublicSubjectOutcome = "proceed" | "ask" | "refuse";

const OUTCOME: Record<NoulAction, PublicSubjectOutcome> = {
  act: "proceed",
  maybe: "ask",
  reject: "refuse",
};

export async function screenPublicSubject(
  workspaceId: string,
  subject: Subject,
  raw: string,
  now: string,
): Promise<{ outcome: PublicSubjectOutcome; verdict: NoulVerdict }> {
  const verdict = await askNoul(workspaceId, PUBLIC_SUBJECT, {
    item: {
      input: raw,
      kind: subject.kind,
      platform: subject.platform ?? null,
      registrable: subject.registrable,
      url: subject.url,
    },
    self: null,
    reliability: "best_effort",
  });
  if (!verdict.cached) {
    await insertVerdict({
      workspaceId,
      questionId: verdict.questionId,
      inputHash: verdict.inputHash,
      signalId: null,
      entityId: null,
      p: verdict.p,
      choice: null,
      reason: null,
      decidedAt: now,
    }).run();
  }
  return { outcome: OUTCOME[noulAction(verdict.p)], verdict };
}
