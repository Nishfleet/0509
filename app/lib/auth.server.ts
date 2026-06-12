import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { redirect } from "react-router";

import { appOrigin, type AppEnv } from "~/lib/env.server";
import type { AppSession } from "~/lib/types";

const CUSTOMER_APP_NAME = "Five to Nine";

function resolveAuthSecret(env: AppEnv) {
  const secret = env.BETTER_AUTH_SECRET?.trim();
  if (secret && secret.length >= 32) {
    return secret;
  }

  throw new Error(
    "BETTER_AUTH_SECRET must be configured with a 32+ character value before auth can serve traffic.",
  );
}

function isSecureOrigin(origin: string) {
  try {
    return new URL(origin).protocol === "https:";
  } catch {
    return false;
  }
}

export function createAuth(env: AppEnv, request: Request) {
  if (!env.DB) {
    throw new Error("Cloudflare D1 binding `DB` is not configured.");
  }

  const origin = appOrigin(env, request);

  return betterAuth({
    appName: env.APP_NAME && env.APP_NAME !== "0509" ? env.APP_NAME : CUSTOMER_APP_NAME,
    baseURL: origin,
    trustedOrigins: [origin],
    secret: resolveAuthSecret(env),
    database: env.DB,
    advanced: {
      defaultCookieAttributes: {
        sameSite: "lax",
        secure: isSecureOrigin(origin),
        httpOnly: true,
      },
    },
    user: {
      additionalFields: {
        onboardedAt: {
          type: "string",
          required: false,
          input: false,
        },
      },
      changeEmail: {
        enabled: true,
        sendChangeEmailVerification: async ({
          user,
          newEmail,
          url,
        }: {
          user: { id: string; email: string; name?: string | null };
          newEmail: string;
          url: string;
          token: string;
        }) => {
          const { sendAccountActionEmail } = await import("~/lib/delivery.server");
          // Verification goes to the CURRENT address so a hijacked session
          // can't silently move the account.
          await sendAccountActionEmail(env, {
            userId: user.id,
            email: user.email,
            name: user.name ?? null,
            kind: "change_email",
            actionUrl: url,
          });
          void newEmail;
        },
      },
      deleteUser: {
        enabled: true,
        beforeDelete: async (user: { id: string; email: string }) => {
          const { getUserPlanBillingInfo } = await import("~/lib/data.server");
          const billing = await getUserPlanBillingInfo(env, user.id);
          assertAccountDeletable(billing);

          // Free account, but a Dodo subscription was linked at some point —
          // tell the operator so a dangling subscription can be double-checked
          // in the Dodo dashboard before the linkage disappears with the row.
          if (billing.dodoSubscriptionId) {
            const { sendOperatorAlertEmail } = await import("~/lib/delivery.server");
            await sendOperatorAlertEmail(env, {
              subject: "0509 account deleted — verify Dodo subscription is closed",
              lines: [
                `Account ${user.email} (${user.id}) was deleted.`,
                `Linked Dodo subscription: ${billing.dodoSubscriptionId} (last status: ${billing.dodoStatus ?? "unknown"}).`,
                "Confirm it is cancelled in the Dodo dashboard.",
              ],
              idempotencyKey: `operator-deletion:${user.id}`,
            }).catch(() => {});
          }
        },
        sendDeleteAccountVerification: async ({ user, url }) => {
          const { sendAccountActionEmail } = await import("~/lib/delivery.server");
          await sendAccountActionEmail(env, {
            userId: user.id,
            email: user.email,
            name: user.name ?? null,
            kind: "delete_account",
            actionUrl: url,
          });
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: async ({ user, url }) => {
        const { sendPasswordResetEmail } = await import("~/lib/delivery.server");
        await sendPasswordResetEmail(env, {
          userId: user.id,
          email: user.email,
          name: user.name ?? null,
          resetUrl: url,
        });
      },
    },
  });
}

export async function getOptionalSession(
  env: AppEnv,
  request: Request,
): Promise<AppSession | null> {
  if (!env.DB) {
    return null;
  }

  const auth = createAuth(env, request);
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  return session as AppSession | null;
}

export async function requireSession(env: AppEnv, request: Request) {
  const session = await getOptionalSession(env, request);

  if (!session) {
    const url = new URL(request.url);
    throw redirect(`/auth/login?redirectTo=${encodeURIComponent(`${url.pathname}${url.search}`)}`);
  }

  return session;
}

// A deleted account cannot cancel its own subscription, and deletion destroys
// the row linking the user to their Dodo subscription — they would keep being
// charged with no account and no way for us to find the subscription. Block
// deletion until billing is settled.
export function assertAccountDeletable(billing: {
  plan: string;
  dodoStatus: string | null;
}) {
  if (billing.plan !== "free") {
    throw new APIError("BAD_REQUEST", {
      message:
        "Your subscription is still active. Cancel it first from Plan & billing (Open billing portal) — you keep access until the end of the period you've paid for, and can delete the account after that.",
    });
  }
}
