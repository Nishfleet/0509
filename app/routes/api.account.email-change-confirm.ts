// GET /api/account/email-change-confirm?changeRequestId=...&token=...
//
// Consumes a pending email change. The token authenticates the click — we
// hash it and look the row up. On success:
//   1. Swap user.email and mark user.emailVerified=true (Better Auth
//      expects verified emails to be reachable).
//   2. Mark account_email_change_request as 'consumed'.
//   3. Revoke all other sessions for this user (Better Auth's
//      revokeOtherSessions). Passkeys stay bound to user.id and continue
//      working — they don't carry the email.
//   4. Email the OLD address a "this changed" notification so an attacker
//      who intercepted the new email can't sneak past unnoticed.

import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { getEnv } from "~/lib/context.server";
import { requireSession } from "~/lib/auth.server";
import {
  consumePendingAccountEmailChange,
  hashAccountSelfServeToken,
  readAccountEmailChangeById,
} from "~/lib/account-self-serve.server";
import { sendCloudflareEmail } from "~/lib/delivery-email-core.server";
import { appBaseUrl } from "~/lib/delivery-email-core.server";
import type { AppEnv } from "~/lib/env.server";

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
  const changeRequestId = String(url.searchParams.get("changeRequestId") ?? "").trim();
  const token = String(url.searchParams.get("token") ?? "").trim();
  if (!changeRequestId || !token) {
    throw redirect("/app/account?email-change=invalid", { status: 303 });
  }
  const tokenHash = await hashAccountSelfServeToken(token);
  const byToken = await env.DB?.prepare(
    "SELECT id FROM account_email_change_request WHERE id = ? AND token_hash = ? AND status = 'pending' LIMIT 1",
  )
    .bind(changeRequestId, tokenHash)
    .first<{ id: string }>();
  if (!byToken) {
    throw redirect("/app/account?email-change=invalid", { status: 303 });
  }
  const row = await readAccountEmailChangeById(env, changeRequestId);
  if (!row || row.user_id !== session.user.id || row.status !== "pending") {
    throw redirect("/app/account?email-change=invalid", { status: 303 });
  }
  if (Date.parse(row.expires_at) < Date.now()) {
    throw redirect("/app/account?email-change=expired", { status: 303 });
  }
  // Atomically consume the row so a concurrent click does not double-swap.
  const consumed = await consumePendingAccountEmailChange(env, row.id);
  if (!consumed) {
    throw redirect("/app/account?email-change=already", { status: 303 });
  }

  // Swap the email. Better Auth verifies on email change, but here we
  // also flip emailVerified=true because the user just proved ownership
  // by clicking the link sent to the new address.
  await env.DB?.prepare(
    "UPDATE user SET email = ?, emailVerified = 1, updatedAt = ? WHERE id = ?",
  )
    .bind(row.new_email, new Date().toISOString(), session.user.id)
    .run();

  // Revoke every other session for this user. Passkeys stay bound to the
  // user id and continue working — they authenticate the user, not the
  // email.
  await revokeOtherSessionsForUser(env, request, session.session.id, session.user.id);

  // Notify the OLD address that the email changed.
  await notifyOldAddress(env, {
    oldEmail: row.current_email,
    newEmail: row.new_email,
    userId: session.user.id,
  }).catch((error) => {
    console.error("[account-self-serve] old-email notification failed", error);
  });

  throw redirect("/app/account?email-change=confirmed", { status: 303 });
}

async function revokeOtherSessionsForUser(
  env: AppEnv,
  request: Request,
  currentSessionId: string,
  userId: string,
): Promise<void> {
  try {
    const { revokeOtherBetterAuthSessions } = await import("~/lib/better-auth.server");
    await revokeOtherBetterAuthSessions(env, request);
  } catch (error) {
    console.error("[account-self-serve] revoke other sessions failed", {
      userId,
      currentSessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function notifyOldAddress(
  env: AppEnv,
  input: { newEmail: string; oldEmail: string; userId: string },
): Promise<void> {
  const subject = "Your Five to Nine email just changed";
  const text =
    `This is a heads-up that the email on your Five to Nine account was just changed to ${input.newEmail}. ` +
    `If you didn't ask for this, reply to this email or write support and we'll revert it.`;
  const html = `
    <div style="font-family: Inter, system-ui, sans-serif; background-color: #ffffff; color: #1d2433; font-size: 15px; line-height: 1.6;">
      <p style="margin: 0 0 12px;">Heads-up,</p>
      <p style="margin: 0 0 12px;">
        The email on your Five to Nine account was just changed to <strong>${escapeSimple(input.newEmail)}</strong>.
        If you didn't ask for this, reply to this email or open a support case from your account and we'll revert it.
      </p>
      <p style="margin: 0; color: #5b6577; font-size: 13px;">
        Sign in at ${escapeSimple(appBaseUrl(env))}/app/account to review recent activity.
      </p>
    </div>
  `;
  await sendCloudflareEmail(env, {
    to: input.oldEmail,
    subject,
    html,
    text,
    tag: "account-email-change-notice",
    unsubscribeUrl: null,
  });
}

function escapeSimple(value: string) {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return ch;
    }
  });
}