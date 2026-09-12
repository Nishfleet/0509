// POST /api/account/email-change-request
//
// In-app email change (issue #3168). Validates the new address, snapshots
// the current address, and emails the NEW address a one-time confirm link.
// The old address stays unchanged until the user clicks the link in the
// new mailbox.

import type { ActionFunctionArgs } from "react-router";

import { getEnv } from "~/lib/context.server";
import { requireSession } from "~/lib/auth.server";
import {
  accountEmailChangeTokenExpiresAt,
  generateAccountSelfServeToken,
  hashAccountSelfServeToken,
  insertPendingAccountEmailChange,
  readPendingAccountEmailChange,
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
  const session = await requireSession(env, request);
  const formData = await readFormData(request);
  const newEmail = String(formData.get("newEmail") ?? "").trim();
  const confirmation = formData.get("confirmEmailChange");

  if (confirmation !== "yes") {
    return Response.json(
      {
        error: "confirm_required",
        message: "Confirm that the new address is yours before sending the verification link.",
      },
      { status: 400 },
    );
  }
  if (!isPlausibleEmail(newEmail)) {
    return Response.json(
      { error: "invalid_email", message: "Enter a valid new email address." },
      { status: 400 },
    );
  }
  if (newEmail.toLowerCase() === session.user.email.toLowerCase()) {
    return Response.json(
      { error: "same_email", message: "That's already the email on this account." },
      { status: 400 },
    );
  }

  // Reuse an existing pending request so the second click doesn't burn a
  // new token — the email step is skipped.
  const existing = await readPendingAccountEmailChange(env, session.user.id);
  if (existing && existing.new_email === newEmail.toLowerCase()) {
    return Response.json(
      {
        ok: true,
        intent: "request-email-change",
        alreadyExists: true,
        changeRequestId: existing.id,
        newEmail: existing.new_email,
      },
      { status: 200 },
    );
  }

  const token = generateAccountSelfServeToken();
  const tokenHash = await hashAccountSelfServeToken(token);
  const now = new Date().toISOString();
  const expiresAt = accountEmailChangeTokenExpiresAt();
  const changeRequestId = `eml_${crypto.randomUUID().split("-").join("")}`;
  const row = await insertPendingAccountEmailChange(env, {
    currentEmail: session.user.email,
    expiresAt,
    id: changeRequestId,
    newEmail: newEmail.toLowerCase(),
    requestedAt: now,
    tokenHash,
    userId: session.user.id,
  });

  const origin = appBaseUrl(env);
  const confirmUrl = new URL("/api/account/email-change-confirm", origin);
  confirmUrl.searchParams.set("changeRequestId", row.id);
  confirmUrl.searchParams.set("token", token);

  await sendAccountActionEmail(env, {
    userId: session.user.id,
    email: row.new_email,
    name: session.user.name ?? null,
    kind: "change_email",
    actionUrl: confirmUrl.toString(),
    extraUrls: [
      {
        label: "Cancel this email change",
        // We expose a plain /app/account#email anchor — the user signs in
        // (still signed in here) and a dismiss button clears the pending
        // row. The form action is /api/account/email-change-cancel.
        url: `${origin}/app/account#email`,
      },
    ],
  }).catch((error) => {
    console.error("[account-self-serve] email-change email failed", error);
  });

  return Response.json(
    {
      ok: true,
      intent: "request-email-change",
      changeRequestId: row.id,
      newEmail: row.new_email,
    },
    { status: 200 },
  );
}

function isPlausibleEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

async function readFormData(request: Request): Promise<FormData> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.toLowerCase().includes("application/x-www-form-urlencoded") ||
      contentType.toLowerCase().includes("multipart/form-data")) {
    return request.formData();
  }
  return new FormData();
}