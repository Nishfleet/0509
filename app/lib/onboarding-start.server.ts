import { z } from "zod";

import { startOnboardingRun } from "./data/onboarding_run.server";
import { isTakenDown } from "./data/takedown.server";
import { readWorkspaceIdForOwner } from "./data/workspace.server";
import { withinProbeLimit } from "./identity/card.server";
import { normaliseSubject } from "./identity/normalise";
import { screenOnboardingSubject } from "./onboarding-screen.server";
import { subjectRedirect } from "./onboarding-subject";

interface Timings {
  measure<T>(name: string, work: Promise<T>): Promise<T>;
}
type Normalised = ReturnType<typeof normaliseSubject>;
type AcceptedSubject = Extract<Normalised, { ok: true }>["subject"];

interface OnboardingSubjectReply {
  message: string | null;
  confirm: { subject: string; raw: string } | null;
}

export type OnboardingSubjectOutcome =
  { status: "reply"; reply: OnboardingSubjectReply } | { status: "next"; path: string } | { status: "home" };

const subjectForm = z.object({
  subject: z.string().optional(),
  answer: z.string().optional(),
});

function readSubjectForm(formData: FormData) {
  const parsed = subjectForm.safeParse(Object.fromEntries(formData));
  const rawSubject = parsed.success ? (parsed.data.subject ?? null) : null;
  return {
    raw: rawSubject,
    rawSubject,
    answer: parsed.success ? (parsed.data.answer ?? null) : null,
    normalised: rawSubject === null ? null : normaliseSubject(rawSubject),
  };
}

async function readTakenAndWorkspace(timings: Timings, userId: string, normalised: Normalised | null) {
  if (!normalised?.ok) return { taken: false, workspaceId: null };
  const [taken, workspaceId] = await timings.measure(
    "workspace",
    Promise.all([isTakenDown(normalised.subject.registrable), readWorkspaceIdForOwner(userId)]),
  );
  return { taken, workspaceId };
}

interface ScreenInput {
  timings: Timings;
  userId: string;
  workspaceId: string;
  subject: AcceptedSubject;
  rawSubject: string;
  answer: string | null;
}

async function screenAndStart({ timings, userId, workspaceId, subject, rawSubject, answer }: ScreenInput) {
  if (!(await timings.measure("limit", withinProbeLimit(userId)))) {
    return {
      message: "You've tried a lot of addresses in the last minute. Wait a minute, then try again.",
      confirm: null,
    };
  }
  const now = new Date().toISOString();
  const result = await timings.measure(
    "screen",
    screenOnboardingSubject({ workspaceId, userId, subject, raw: rawSubject, answer, now }),
  );
  if (result.kind === "refuse" || result.kind === "unavailable") return { message: result.message, confirm: null };
  if (result.kind === "ask") return { message: null, confirm: { subject: result.subject, raw: rawSubject } };
  await timings.measure("run", startOnboardingRun({ workspaceId, userId, inputRaw: rawSubject, startedAt: now }));
  return null;
}

const TAKEN_DOWN: OnboardingSubjectReply = {
  message: "This brand asked us not to track it, so we can't set it up. Try your own website address.",
  confirm: null,
};

const UNRESOLVED: OnboardingSubjectReply = {
  message:
    "We couldn't find a website or username in that. Try an address like yourbrand.com or a username like @yourbrand.",
  confirm: null,
};

export async function submitOnboardingSubject(input: {
  timings: Timings;
  userId: string;
  formData: FormData;
}): Promise<OnboardingSubjectOutcome> {
  const { timings, userId, formData } = input;
  const { raw, rawSubject, answer, normalised } = readSubjectForm(formData);
  const { taken, workspaceId } = await readTakenAndWorkspace(timings, userId, normalised);
  if (taken) return { status: "reply", reply: TAKEN_DOWN };
  if (normalised?.ok && rawSubject !== null) {
    if (workspaceId === null) return { status: "home" };
    const outcome = await screenAndStart({
      timings,
      userId,
      workspaceId,
      subject: normalised.subject,
      rawSubject,
      answer,
    });
    if (outcome !== null) return { status: "reply", reply: outcome };
  }
  const path = subjectRedirect(raw);
  return path === null ? { status: "reply", reply: UNRESOLVED } : { status: "next", path };
}
