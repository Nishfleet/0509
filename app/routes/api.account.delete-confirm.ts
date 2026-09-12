// GET /api/account/delete-confirm?deletionId=...
//
// Second half of the in-app account deletion flow (issue #3168). The user
// clicked the link in the email sent by /api/account/delete-request. We
// validate the request row, confirm it is still pending, and redirect back
// to /app/account with a notice that the 7-day grace timer is running.
//
// No state mutation here — the row was already 'pending' when
// /api/account/delete-request inserted it. The grace window is fixed at
// insert time (scheduled_for = requested_at + 7d), so the confirm step is
// pure acknowledgement. If the row is already 'completed' or 'cancelled'
// (the user raced a cancel link), the redirect carries the correct notice.

import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { getEnv } from "~/lib/context.server";
import { requireSession } from "~/lib/auth.server";
import { readAccountDeletionById } from "~/lib/account-self-serve.server";

export async function action() {
  return Response.json(
    { error: "Method not allowed. Use GET." },
    { status: 405, headers: { Allow: "GET" } },
  );
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const url = new URL(request.url);
  const deletionId = String(url.searchParams.get("deletionId") ?? "").trim();
  if (!deletionId) {
    throw redirect("/app/account?deletion=invalid", { status: 303 });
  }
  const row = await readAccountDeletionById(env, deletionId);
  if (!row || row.user_id !== session.user.id) {
    throw redirect("/app/account?deletion=invalid", { status: 303 });
  }
  if (row.status === "cancelled") {
    throw redirect("/app/account?deletion=cancelled", { status: 303 });
  }
  if (row.status === "completed") {
    throw redirect("/app/account?deletion=completed", { status: 303 });
  }
  throw redirect("/app/account?deletion=pending", { status: 303 });
}