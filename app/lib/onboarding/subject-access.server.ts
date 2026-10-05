import { isTakenDown } from "../data/takedown.server";
import { normaliseSubject, type Subject } from "../identity/normalise";
import { requireSession, signOutToLogin } from "../require-session.server";
import type { createTimings } from "../server-timing.server";
import { workspaceLandingForRequest } from "../workspace.server";

export async function readSubjectAccess(request: Request, timings: ReturnType<typeof createTimings>) {
  const raw = new URL(request.url).searchParams.get("subject") ?? "";
  const normalised = normaliseSubject(raw);
  const subject: Subject | null = normalised.ok ? normalised.subject : null;
  const session = await timings.measure("session", requireSession(request));
  const [taken, { landing, workspaceId }] = await Promise.all([
    subject === null ? false : timings.measure("takedown", isTakenDown(subject.registrable)),
    timings.measure("workspace", workspaceLandingForRequest(request, session.user)),
  ]);
  if (workspaceId === null) await signOutToLogin(request);
  return { raw, subject, taken, landing, workspaceId, userId: session.user.id };
}
