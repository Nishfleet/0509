import { insertVerdicts, type VerdictRow } from "../data/jev_verdict.server";
import { JevUnavailableError, askNouls, type NoulQuestion, type NoulVerdict } from "../jev/client.server";
import { noulAction } from "../jev/thresholds";
import type { CardReview, CardValues, FieldReview } from "./card-fields";
import type { Subject } from "./normalise";

const NAME_QUESTION: NoulQuestion = {
  id: "identity_field_confidence.name",
  instructions: "Is `fields.name` the right brand name for the brand at `subject`?",
  whenTrue: "It is this brand's own name.",
  whenFalse: "It is wrong, generic, or belongs to someone else.",
};

const DESCRIPTION_QUESTION: NoulQuestion = {
  id: "identity_field_confidence.description",
  instructions: "Is `fields.description` the right one-line description for the brand at `subject`?",
  whenTrue: "It is this brand's own one-line description.",
  whenFalse: "It is wrong, generic, or belongs to someone else.",
};

const SOCIALS_QUESTION: NoulQuestion = {
  id: "identity_field_confidence.socials",
  instructions: "Are the items in `fields.socials` the list of official social profiles for the brand at `subject`?",
  whenTrue: "It is this brand's own list of official social profiles.",
  whenFalse: "It is wrong, generic, or belongs to someone else.",
};

function reviewFor(p: number): FieldReview {
  const action = noulAction(p);
  if (action === "act") return "fill";
  if (action === "maybe") return "check";
  return "empty";
}

function buildQuestions(fields: CardValues): NoulQuestion[] {
  const out: NoulQuestion[] = [];
  if (fields.name !== null) out.push(NAME_QUESTION);
  if (fields.description !== null) out.push(DESCRIPTION_QUESTION);
  if (fields.socials.length > 0) out.push(SOCIALS_QUESTION);
  return out;
}

function reviewAll(review: FieldReview): CardReview {
  return { name: review, description: review, socials: review };
}

function reviewValued(fields: CardValues, review: FieldReview): CardReview {
  return {
    name: fields.name === null ? "empty" : review,
    description: fields.description === null ? "empty" : review,
    socials: fields.socials.length === 0 ? "empty" : review,
  };
}

const FIELD_BY_QUESTION: ReadonlyMap<string, keyof CardReview> = new Map([
  [NAME_QUESTION.id, "name"],
  [DESCRIPTION_QUESTION.id, "description"],
  [SOCIALS_QUESTION.id, "socials"],
]);

export async function reviewFields(
  workspaceId: string,
  subject: Subject,
  fields: CardValues,
  now: string,
): Promise<CardReview> {
  const questions = buildQuestions(fields);
  if (questions.length === 0) return reviewAll("empty");
  let verdicts: NoulVerdict[];
  try {
    verdicts = await askNouls(workspaceId, questions, {
      subject: { registrable: subject.registrable, url: subject.url, kind: subject.kind },
      fields: { name: fields.name, description: fields.description, socials: fields.socials },
      reliability: "best_effort",
    });
  } catch (error) {
    if (error instanceof JevUnavailableError) return reviewValued(fields, "check");
    throw error;
  }
  const rows: VerdictRow[] = verdicts
    .filter((verdict) => !verdict.cached)
    .map((verdict) => ({
      workspaceId,
      questionId: verdict.questionId,
      inputHash: verdict.inputHash,
      signalId: null,
      entityId: null,
      p: verdict.p,
      choice: null,
      reason: null,
      decidedAt: now,
    }));
  await insertVerdicts(rows);
  console.log(
    JSON.stringify({
      event: "identity-field-confidence",
      subject: subject.registrable,
      verdicts: verdicts.map((verdict) => ({
        questionId: verdict.questionId,
        inputHash: verdict.inputHash,
        p: verdict.p,
        action: noulAction(verdict.p),
      })),
    }),
  );
  const review = reviewValued(fields, "empty");
  for (const verdict of verdicts) {
    const field = FIELD_BY_QUESTION.get(verdict.questionId);
    if (field !== undefined) review[field] = reviewFor(verdict.p);
  }
  return review;
}
