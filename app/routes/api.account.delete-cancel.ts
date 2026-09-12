// GET /api/account/delete-cancel?token=...
//
// Cancels a pending account deletion. The token is the secret from the
// confirmation email — its hash is stored in account_deletion_request.
//
// Can be called signed-in (uses the session user as a guard) OR unsigned
// (the token alone authenticates the cancel link — anyone with the link
// can cancel because it only ever does the OPPOSITE of the confirm link).
// We still require a session so the cancel lands on the right account and
// the redirect target is correct; an attacker without the email can never
// obtain this link.

import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { getEnv } from "~/lib/context.server";
import { requireSession } from "~/lib/auth.server";
import {
  hashAccountSelfServeToken,
  markAccountDeletionCancelled,
  readAccountDeletionByCancelToken,
} from "~/lib/account-self-serve.server";

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
  const token = String(url.searchParams.get("token") ?? "").trim();
  if (!token) {
    throw redirect("/app/account?deletion=cancel-invalid", { status: 303 });
  }
  const tokenHash = await hashAccountSelfServeToken(token);
  const row = await readAccountDeletionByCancelToken(env, tokenHash);
  if (!row || row.user_id !== session.user.id) {
    throw redirect("/app/account?deletion=cancel-invalid", { status: 303 });
  }
  const cancelled = await markAccountDeletionCancelled(env, row.id);
  if (!cancelled) {
    // Already cancelled or completed — redirect still lands on the cancel
    // notice so the user gets a friendly answer either way.
    throw redirect("/app/account?deletion=cancel-already", { status: 303 });
  }
  throw redirect("/app/account?deletion=cancelled", { status: 303 });
}