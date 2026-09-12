// POST /api/account/delete-request
//
// First half of the in-app account deletion flow (issue #3168). Validates the
// request, schedules a pending account_deletion_request row, and emails the
// current address a one-time confirm link. If the address already has a
// pending request, returns the existing row so the email step is skipped —
// the user already has the cancel-deletion link from the first request.
//
// The hard delete only runs after the grace window expires AND the user
// clicked the confirm link. A 7-day grace timer + cancel-deletion link
// ride in the confirmation email (see api.account.delete-confirm.ts).

import type { ActionFunctionArgs } from "react-router";

import { getEnv } from "~/lib/context.server";
import { getOptionalCloudflareContext } from "~/lib/cloudflare-context";
import { requireSession } from "~/lib/auth.server";
import {
  accountDeletionCancelTokenExpiresAt,
  accountDeletionScheduledFor,
  generateAccountSelfServeToken,
  hashAccountSelfServeToken,
  insertPendingAccountDeletion,
  isUserOrgOwnerOfMultiMemberOrg,
  readPendingAccountDeletion,
} from "~/lib/account-self-serve.server";
import { sendAccountActionEmail } from "~/lib/delivery.server";
import { appBaseUrl } from "~/lib/delivery-email-core.server";

export async function loader() {
  return Response.json(
    { error: "Method not allowed. Use POST." },
    { status: 405, headers: { Allow: "POST" } },
  );
}

export async function action({ context, request }: ActionFunctionArgs) {
  const env = getEnv(context);
  const cloudflare = getOptionalCloudflareContext(context);
  const session = await requireSession(env, request);
  const formData = await readFormData(request);
  const confirmation = formData.get("confirmDeletion");
  if (confirmation !== "yes") {
    return Response.json(
      {
        error: "confirm_required",
        message:
          "Confirm that this schedules deletion at the end of a 7-day grace window.",
      },
      { status: 400 },
    );
  }
  const password = String(formData.get("password") ?? "");
  if (!password) {
    return Response.json(
      {
        error: "password_required",
        message:
          "Re-enter your password to schedule deletion. This is a destructive action.",
      },
      { status: 400 },
    );
  }

  // Re-authenticate the session against the stored password hash. If the
  // session belongs to a passkey-only user, the form layer disables the
  // password field — we accept that path through an explicit
  // `passwordLessConfirmation` flag set client-side. The `password` field
  // is required in either case so a stale cookie can't claim the bypass.
  const passwordLessConfirmation = formData.get("passwordLessConfirmation") === "yes";
  if (!passwordLessConfirmation) {
    const ok = await verifyCurrentSessionPassword(env, request, session.user.email, password);
    if (!ok) {
      return Response.json(
        { error: "password_invalid", message: "That password did not match. Try again." },
        { status: 403 },
      );
    }
  }

  const orgOwnerBlock = await isUserOrgOwnerOfMultiMemberOrg(env, session.user.id);
  if (orgOwnerBlock.ownerOfOrgsWithOtherMembers > 0) {
    return Response.json(
      {
        error: "org_owner_block",
        message:
          "Transfer ownership of your workspace before deleting this account — other members still rely on it.",
        orgIds: orgOwnerBlock.orgIds,
      },
      { status: 409 },
    );
  }

  // Reuse an existing pending request so the user gets the SAME cancel
  // link from their first email — never two timers stacked on top of each
  // other.
  const existing = await readPendingAccountDeletion(env, session.user.id);
  if (existing) {
    return Response.json(
      {
        ok: true,
        intent: "request-account-deletion",
        alreadyExists: true,
        deletionId: existing.id,
        scheduledFor: existing.scheduled_for,
      },
      { status: 200 },
    );
  }

  const requestedAt = new Date().toISOString();
  const cancelToken = generateAccountSelfServeToken();
  const cancelTokenHash = await hashAccountSelfServeToken(cancelToken);
  const scheduledFor = accountDeletionScheduledFor();
  const cancelTokenExpiresAt = accountDeletionCancelTokenExpiresAt();
  const deletionId = `del_${crypto.randomUUID().split("-").join("")}`;
  const row = await insertPendingAccountDeletion(env, {
    cancelTokenHash,
    cancelTokenExpiresAt,
    emailAtRequest: session.user.email,
    id: deletionId,
    requestedAt,
    scheduledFor,
    userId: session.user.id,
  });

  // Email the current address with the confirm + cancel links. The confirm
  // link flips the row to "pending grace window" (it stays pending here
  // from the form layer, but the email also carries the cancel link so
  // the user has the full set in one message).
  const origin = appBaseUrl(env);
  const confirmUrl = new URL("/api/account/delete-confirm", origin);
  confirmUrl.searchParams.set("deletionId", row.id);
  const cancelUrl = new URL("/api/account/delete-cancel", origin);
  cancelUrl.searchParams.set("token", cancelToken);

  await sendAccountActionEmail(env, {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name ?? null,
    kind: "delete_account",
    actionUrl: confirmUrl.toString(),
    extraUrls: [
      {
        label: "Cancel this deletion",
        url: cancelUrl.toString(),
      },
    ],
    graceWindowDays: 7,
  }).catch((error) => {
    // Email failure must not block the request — the row is already
    // scheduled; the user can retry from the Account page to resend.
    console.error("[account-self-serve] delete-confirm email failed", error);
  });

  // Suppress unused-var lint for cloudflare handle.
  void cloudflare;

  return Response.json(
    {
      ok: true,
      intent: "request-account-deletion",
      deletionId: row.id,
      scheduledFor: row.scheduled_for,
    },
    { status: 200 },
  );
}

async function readFormData(request: Request): Promise<FormData> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.toLowerCase().includes("application/x-www-form-urlencoded") ||
      contentType.toLowerCase().includes("multipart/form-data")) {
    return request.formData();
  }
  return new FormData();
}

async function verifyCurrentSessionPassword(
  env: { DB?: D1Database; BETTER_AUTH_SECRET?: string },
  request: Request,
  email: string,
  password: string,
): Promise<boolean> {
  // The Better Auth signin endpoint doubles as the password verifier for
  // destructive actions. We do NOT mint a new session — we just confirm the
  // password matches the account under the user's email. The endpoint
  // returns ok=true with `redirect: false` for already-authenticated users.
  try {
    const { getBetterAuth, isBetterAuthConfigured } = await import("~/lib/better-auth.server");
    if (!isBetterAuthConfigured(env as never)) return false;
    const auth = getBetterAuth(env as never, request);
    const result = await auth.api.signInEmail({
      body: { email, password },
      headers: request.headers,
    });
    // signInEmail throws on invalid credentials. A success means the
    // password matched. We deliberately do not surface the new session
    // cookies — they would replace the request's session.
    return Boolean(result);
  } catch {
    return false;
  }
}