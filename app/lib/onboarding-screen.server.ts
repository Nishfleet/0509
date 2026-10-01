import { captureException } from "@sentry/cloudflare";

import { isLoginWall, type Subject } from "./identity/normalise";
import { readSubjectDecision, insertSubjectDecision } from "./data/user_decision.server";
import { JevUnavailableError } from "./jev/client.server";
import { screenPublicSubject } from "./jev/public-subject.server";

export const REFUSAL = "Five to Nine tracks brands and creators, not private individuals.";

export type ScreenResult = { kind: "proceed" } | { kind: "refuse"; message: string } | { kind: "ask"; subject: string };

const runJevOutcome = (input: {
  workspaceId: string;
  subject: Subject;
  raw: string;
  now: string;
}): Promise<{ outcome: "proceed" | "ask" | "refuse" } | null> =>
  screenPublicSubject(input).catch((error: unknown) => {
    if (!(error instanceof JevUnavailableError)) throw error;
    console.log(
      JSON.stringify({
        event: "public_subject.jev_unavailable",
        workspaceId: input.workspaceId,
        error: error.message.slice(0, 300),
      }),
    );
    captureException(error, { tags: { jev: "public_subject" } });
    return null;
  });

interface ScreenInput {
  workspaceId: string;
  userId: string;
  subject: Subject;
  raw: string;
  answer: string | null;
  now: string;
}

async function decide(input: ScreenInput, verdict: "public_subject:confirmed" | "public_subject:refused") {
  await insertSubjectDecision({
    workspaceId: input.workspaceId,
    userId: input.userId,
    subject: input.subject.registrable,
    verdict,
    decidedAt: input.now,
  });
}

async function refuse(input: ScreenInput): Promise<ScreenResult> {
  await decide(input, "public_subject:refused");
  return { kind: "refuse", message: REFUSAL };
}

async function settle(input: ScreenInput, outcome: "proceed" | "ask" | "refuse"): Promise<ScreenResult> {
  if (outcome === "proceed") return { kind: "proceed" };
  if (outcome === "refuse" || input.answer === "person") return refuse(input);
  if (input.answer === "business") {
    await decide(input, "public_subject:confirmed");
    return { kind: "proceed" };
  }
  return { kind: "ask", subject: input.subject.registrable };
}

export async function screenOnboardingSubject(input: ScreenInput): Promise<ScreenResult> {
  const ground = isLoginWall(input.raw) ? "login" : null;
  const screening = ground === null ? runJevOutcome(input) : null;
  screening?.catch(() => undefined);
  const decided = await readSubjectDecision(input.workspaceId, input.subject.registrable);
  if (decided === "public_subject:confirmed") return { kind: "proceed" };
  if (decided === "public_subject:refused") return { kind: "refuse", message: REFUSAL };

  console.log(JSON.stringify({ event: "public_subject.screen", fetched: false, ground }));
  if (screening === null) return refuse(input);
  const screened = await screening;
  return settle(input, screened === null ? "ask" : screened.outcome);
}
