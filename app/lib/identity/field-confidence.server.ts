import { insertVerdicts, type VerdictRow } from "../data/jev_verdict.server";
import { JevUnavailableError, askNouls, type NoulQuestion, type NoulVerdict } from "../jev/client.server";
import { noulAction } from "../jev/thresholds";
import type { CardReview, CardValues, DraftField, FieldReview } from "./card-fields";
import type { Subject } from "./normalise";

export const NAME_QUESTION: NoulQuestion = {
  id: "identity_field_confidence.name",
  instructions: "Is `fields.name` the right brand name for the brand at `subject`?",
  whenTrue: "It is this brand's own name.",
  whenFalse:
    "It is wrong, generic, belongs to someone else, or is a related form that is not the brand's name: a product line, a sub-brand, a founder's or owner's personal name, a slogan, a legal-entity suffix the brand does not use in its name, or a name the same brand uses in another market.",
};

export const DESCRIPTION_QUESTION: NoulQuestion = {
  id: "identity_field_confidence.description",
  instructions: "Is `fields.description` the right one-line description for the brand at `subject`?",
  whenTrue: "It is this brand's own one-line description.",
  whenFalse: "It is wrong, generic, or belongs to someone else.",
};

export const SOCIALS_QUESTION: NoulQuestion = {
  id: "identity_field_confidence.socials",
  instructions: "Are the items in `fields.socials` the list of official social profiles for the brand at `subject`?",
  whenTrue: "Every listed profile is one the brand itself runs, on the platform the link names.",
  whenFalse:
    "At least one listed profile is run by someone else: a fan, an employee's personal account, a reseller, a parody, a squatter, or a competitor, even when the handle looks like the brand's own.",
};

export function fieldConfidenceState(
  subject: Subject,
  fields: CardValues,
  edited: readonly DraftField[],
): Record<string, unknown> {
  return {
    subject: { registrable: subject.registrable, url: subject.url, kind: subject.kind },
    fields: { name: fields.name, description: fields.description, socials: fields.socials },
    user_memory: { edited_fields: edited },
    reliability: "best_effort",
  };
}

function reviewFor(p: number): FieldReview {
  const action = noulAction(p);
  if (action === "act") return "fill";
  if (action === "maybe") return "check";
  return "empty";
}

function buildQuestions(fields: CardValues, edited: readonly DraftField[]): NoulQuestion[] {
  const out: NoulQuestion[] = [];
  if (fields.name !== null && !edited.includes("name")) out.push(NAME_QUESTION);
  if (fields.description !== null && !edited.includes("description")) out.push(DESCRIPTION_QUESTION);
  if (fields.socials.length > 0) out.push(SOCIALS_QUESTION);
  return out;
}

function reviewValued(fields: CardValues, review: FieldReview): CardReview {
  return {
    name: fields.name === null ? "empty" : review,
    description: fields.description === null ? "empty" : review,
    socials: fields.socials.length === 0 ? "empty" : review,
  };
}

function withEdited(review: CardReview, edited: readonly DraftField[]): CardReview {
  let next = review;
  if (edited.includes("name")) next = { ...next, name: "fill" };
  if (edited.includes("description")) next = { ...next, description: "fill" };
  return next;
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
  edited: readonly DraftField[],
  now: string,
): Promise<CardReview> {
  const questions = buildQuestions(fields, edited);
  if (questions.length === 0) return withEdited(reviewValued(fields, "empty"), edited);
  let verdicts: NoulVerdict[];
  try {
    verdicts = await askNouls(workspaceId, questions, fieldConfidenceState(subject, fields, edited));
  } catch (error) {
    if (error instanceof JevUnavailableError) return withEdited(reviewValued(fields, "check"), edited);
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
      workspaceId,
      verdicts: verdicts.map((verdict) => ({
        questionId: verdict.questionId,
        inputHash: verdict.inputHash,
        p: verdict.p,
        action: noulAction(verdict.p),
      })),
    }),
  );
  let review: CardReview = reviewValued(fields, "empty");
  for (const verdict of verdicts) {
    const field = FIELD_BY_QUESTION.get(verdict.questionId);
    if (field !== undefined) review = { ...review, [field]: reviewFor(verdict.p) };
  }
  return withEdited(review, edited);
}
