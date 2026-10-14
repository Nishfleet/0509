import type { Route } from "./+types/app.change-feedback";

import { redirect } from "react-router";
import { z } from "zod";

import { recordChangeFeedback } from "../lib/data/user_decision.server";
import { onboardedContext } from "../lib/require-onboarded.server";

const feedbackForm = z.object({ signalId: z.string().min(1), value: z.enum(["useful", "not_useful"]) });

const FALLBACK = "/app/alerts";

function backPath(request: Request, signalId: string): string {
  const referer = request.headers.get("referer");
  if (referer === null) return `${FALLBACK}#${encodeURIComponent(signalId)}`;
  const from = new URL(referer);
  const sameSite = from.origin === new URL(request.url).origin && from.pathname.startsWith("/app");
  return sameSite ? `${from.pathname}${from.search}#${encodeURIComponent(signalId)}` : FALLBACK;
}

export function loader() {
  return redirect(FALLBACK);
}

export async function action({ request, context }: Route.ActionArgs) {
  const { session, workspaceId } = context.get(onboardedContext);
  const parsed = feedbackForm.safeParse(Object.fromEntries(await request.formData()));
  if (workspaceId === null || !parsed.success) return redirect(FALLBACK, 303);
  await recordChangeFeedback({
    workspaceId,
    userId: session.user.id,
    signalId: parsed.data.signalId,
    useful: parsed.data.value === "useful",
    decidedAt: new Date().toISOString(),
  });
  return redirect(backPath(request, parsed.data.signalId), 303);
}
