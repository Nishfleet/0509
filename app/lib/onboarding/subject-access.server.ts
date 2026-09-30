import { isTakenDown } from "../data/takedown.server";
import { readWorkspaceIdForOwner } from "../data/workspace.server";
import { normaliseSubject, type Subject } from "../identity/normalise";
import { requireSession } from "../require-session.server";
import type { createTimings } from "../server-timing.server";
import { workspaceLandingForRequest } from "../workspace.server";

export async function readSubjectAccess(request: Request, timings: ReturnType<typeof createTimings>) {
  const raw = new URL(request.url).searchParams.get("subject") ?? "";
  const normalised = normaliseSubject(raw);
  const subject: Subject | null = normalised.ok ? normalised.subject : null;
  const [session, taken] = await Promise.all([
    timings.measure("session", requireSession(request)),
    subject === null ? false : timings.measure("takedown", isTakenDown(subject.registrable)),
  ]);
  const [landing, workspaceId] = await timings.measure(
    "workspace",
    Promise.all([workspaceLandingForRequest(request, session.user), readWorkspaceIdForOwner(session.user.id)]),
  );
  return { raw, subject, taken, landing, workspaceId, userId: session.user.id };
}
