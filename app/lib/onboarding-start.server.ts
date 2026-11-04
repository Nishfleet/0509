import { redirect } from "react-router";
import { z } from "zod";

import { readDiscoveryContext } from "./data/entity.server";
import { startOnboardingRun } from "./data/onboarding_run.server";
import { isTakenDown } from "./data/takedown.server";
import { readWorkspaceIdForOwner } from "./data/workspace.server";
import { withinProbeLimit } from "./identity/card.server";
import { ABOUT_MAX, NAME_MAX, overLimitField } from "./identity/card-fields";
import { normaliseSubject } from "./identity/normalise";
import { screenOnboardingSubject } from "./onboarding-screen.server";
import { subjectRedirect } from "./onboarding-subject";

interface Timings {
  measure<T>(name: string, work: Promise<T>): Promise<T>;
}
type Normalised = ReturnType<typeof normaliseSubject>;
type AcceptedSubject = Extract<Normalised, { ok: true }>["subject"];

export type OnboardingSubjectOutcome =
  | { status: "reply"; reply: { message: string | null; confirm: { subject: string; raw: string } | null } }
  | { status: "next"; path: string }
  | { status: "home" };

type OnboardingSubjectReply = Extract<OnboardingSubjectOutcome, { status: "reply" }>["reply"];

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

export async function ensureOnboardingRun(input: { workspaceId: string; userId: string; now: string }): Promise<void> {
  const context = await readDiscoveryContext(input.workspaceId);
  if (context === null) return;
  await startOnboardingRun({
    workspaceId: input.workspaceId,
    userId: input.userId,
    inputRaw: context.self.domain,
    startedAt: input.now,
  });
}

export async function screenIdentitySubject(
  timings: Timings,
  input: { workspaceId: string; userId: string; rawSubject: string | undefined },
): Promise<{ message: string } | null> {
  const { workspaceId, userId, rawSubject } = input;
  if (rawSubject === undefined) return null;
  const normalised = normaliseSubject(rawSubject);
  if (!normalised.ok) return null;
  if (!(await timings.measure("limit", withinProbeLimit(userId)))) {
    return { message: "You've tried a lot of addresses in the last minute. Wait a minute, then try again." };
  }
  const screened = await timings.measure(
    "screen",
    screenOnboardingSubject({
      workspaceId,
      userId,
      subject: normalised.subject,
      raw: rawSubject,
      answer: null,
      now: new Date().toISOString(),
    }),
  );
  if (screened.kind !== "proceed") throw redirect("/onboarding");
  return null;
}

export async function startIdentityRun(input: {
  workspaceId: string;
  userId: string;
  rawSubject: string | undefined;
}): Promise<void> {
  if (input.rawSubject === undefined) return;
  await startOnboardingRun({
    workspaceId: input.workspaceId,
    userId: input.userId,
    inputRaw: input.rawSubject,
    startedAt: new Date().toISOString(),
  });
}

const confirmFields = z.object({ name: z.string().optional(), description: z.string().optional() });

export function confirmFailureMessage(formData: FormData): string {
  const fields = confirmFields.safeParse(Object.fromEntries(formData));
  const tooLong = fields.success ? overLimitField(fields.data.name, fields.data.description) : null;
  if (tooLong === "name") return `That name is too long. Keep it to ${String(NAME_MAX)} characters or fewer.`;
  if (tooLong === "about") return `That about line is too long. Keep it to ${String(ABOUT_MAX)} characters or fewer.`;
  return "Add your brand's name, then tap Looks right.";
}
