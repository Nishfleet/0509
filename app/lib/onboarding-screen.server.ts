import { isLoginWall, type Subject } from "./identity/normalise";
import { readSubjectDecision, insertSubjectDecision } from "./data/user_decision.server";
import { JevUnavailableError } from "./jev/client.server";
import { screenPublicSubject } from "./jev/public-subject.server";

export const REFUSAL = "we track brands and creators, not people";

export const UNAVAILABLE = "we can't check that right now, so we haven't looked it up. Try again in a few minutes";

export type ScreenResult =
  | { kind: "proceed" }
  | { kind: "refuse"; message: string }
  | { kind: "ask"; subject: string }
  | { kind: "unavailable"; message: string };

const runJevOutcome = (input: {
  workspaceId: string;
  subject: Subject;
  raw: string;
  now: string;
}): Promise<{ outcome: "proceed" | "ask" | "refuse" } | null> =>
  screenPublicSubject(input.workspaceId, input.subject, input.raw, input.now).catch((error: unknown) => {
    if (error instanceof JevUnavailableError) return null;
    throw error;
  });

export async function screenOnboardingSubject(input: {
  workspaceId: string;
  userId: string;
  subject: Subject;
  raw: string;
  answer: string | null;
  now: string;
}): Promise<ScreenResult> {
  const decided = await readSubjectDecision(input.workspaceId, input.subject.registrable);
  if (decided === "public_subject:confirmed") return { kind: "proceed" };
  if (decided === "public_subject:refused") return { kind: "refuse", message: REFUSAL };

  const ground = isLoginWall(input.raw) ? "login" : null;
  console.log(JSON.stringify({ event: "public_subject.screen", fetched: false, ground }));
  if (ground === "login") {
    await insertSubjectDecision({
      workspaceId: input.workspaceId,
      userId: input.userId,
      subject: input.subject.registrable,
      verdict: "public_subject:refused",
      decidedAt: input.now,
    });
    return { kind: "refuse", message: REFUSAL };
  }

  const screened = await runJevOutcome(input);
  if (screened === null) return { kind: "unavailable", message: UNAVAILABLE };
  const { outcome } = screened;
  if (outcome === "proceed") return { kind: "proceed" };

  if (outcome === "refuse") {
    await insertSubjectDecision({
      workspaceId: input.workspaceId,
      userId: input.userId,
      subject: input.subject.registrable,
      verdict: "public_subject:refused",
      decidedAt: input.now,
    });
    return { kind: "refuse", message: REFUSAL };
  }

  if (input.answer === "business") {
    await insertSubjectDecision({
      workspaceId: input.workspaceId,
      userId: input.userId,
      subject: input.subject.registrable,
      verdict: "public_subject:confirmed",
      decidedAt: input.now,
    });
    return { kind: "proceed" };
  }

  if (input.answer === "person") {
    await insertSubjectDecision({
      workspaceId: input.workspaceId,
      userId: input.userId,
      subject: input.subject.registrable,
      verdict: "public_subject:refused",
      decidedAt: input.now,
    });
    return { kind: "refuse", message: REFUSAL };
  }

  return { kind: "ask", subject: input.subject.registrable };
}
