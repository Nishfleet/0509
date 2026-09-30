import { describe, expect, it, vi } from "vitest";

import type { DraftField, CardValues } from "../../app/lib/identity/card-fields";
import {
  DESCRIPTION_QUESTION,
  NAME_QUESTION,
  SOCIALS_QUESTION,
  fieldConfidenceState,
} from "../../app/lib/identity/field-confidence.server";
import { PAGE_ROLE, pageRoleState } from "../../app/lib/identity/page-role.server";
import type { Subject } from "../../app/lib/identity/normalise";
import { PUBLIC_SUBJECT, publicSubjectState } from "../../app/lib/jev/public-subject.server";
import {
  choiceScore,
  formatReport,
  jevKeyPresent,
  loadCases,
  makeChoiceAsk,
  makeNoulAsk,
  noulScore,
  runEval,
  type Ask,
  type ChoiceEvalRow,
  type NoulEvalRow,
  type Score,
} from "./harness";

vi.mock("../../app/lib/data/jev_verdict.server", () => ({
  insertVerdicts: () => Promise.resolve(),
  insertVerdict: () => ({ run: () => Promise.resolve() }),
}));
vi.mock("../../app/lib/data/page.server", () => ({
  readPageHashes: () => Promise.resolve(new Map()),
  upsertJudgedPages: () => Promise.resolve(),
}));
vi.mock("../../app/lib/jev/client.server", () => ({
  askNoul: () => Promise.resolve(null),
  askNouls: () => Promise.resolve([]),
  askChoice: () => Promise.resolve(null),
  JevUnavailableError: class JevUnavailableError extends Error {},
}));

interface FieldCase extends NoulEvalRow {
  subject: Subject;
  fields: CardValues;
  edited: DraftField[];
}

interface PublicSubjectCase extends NoulEvalRow {
  raw: string;
  subject: Subject;
}

interface PageCase extends ChoiceEvalRow {
  subject: { domain: string };
  page: { url: string; title: string };
}

describe.skipIf(!jevKeyPresent())("eval: identity field confidence against Jev", () => {
  it.each([
    ["name", NAME_QUESTION],
    ["description", DESCRIPTION_QUESTION],
    ["socials", SOCIALS_QUESTION],
  ] as const)("identity_field_confidence.%s: scores the shipped text on both splits", async (field, question) => {
    const rows = await loadCases<FieldCase>(`identity_field_confidence.${field}`, ["subject", "fields", "edited"]);
    const ask: Ask<FieldCase> = (row) =>
      makeNoulAsk(question)(fieldConfidenceState(row.subject, row.fields, row.edited));
    const score: Score<FieldCase> = noulScore;
    const report = await runEval(`identity_field_confidence.${field}`, rows, ask, score);
    console.log(formatReport(report));
    expect(report.splits.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!jevKeyPresent())("eval: public subject gate against Jev", () => {
  it("public_subject: scores the shipped text on both splits", async () => {
    const rows = await loadCases<PublicSubjectCase>("public_subject", ["raw", "subject"]);
    const ask: Ask<PublicSubjectCase> = (row) =>
      makeNoulAsk(PUBLIC_SUBJECT)(publicSubjectState(row.subject, row.raw));
    const report = await runEval("public_subject", rows, ask, noulScore);
    console.log(formatReport(report));
    expect(report.splits.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!jevKeyPresent())("eval: page role against Jev", () => {
  it("page_role: scores the shipped options on both splits", async () => {
    const rows = await loadCases<PageCase>("page_role", ["subject", "page"]);
    const ask: Ask<PageCase> = (row) => makeChoiceAsk(PAGE_ROLE)(pageRoleState(row.subject.domain, row.page));
    const report = await runEval("page_role", rows, ask, choiceScore);
    console.log(formatReport(report));
    expect(report.splits.length).toBeGreaterThan(0);
  });
});
