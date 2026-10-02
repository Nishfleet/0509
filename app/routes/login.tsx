import type { Route } from "./+types/login";
import { env } from "cloudflare:workers";
import { useState } from "react";
import { data, useActionData, useLoaderData, useNavigation, useSearchParams } from "react-router";

import { AccountDeleteNotice } from "../components/account-delete-notice";
import { SignInEmailForm, SignInError } from "../components/sign-in-email-form";
import { SIGN_IN_LEDE, SIGN_IN_SHELL, SIGN_IN_TITLE, SignInSent } from "../components/sign-in-sent";
import { PasskeyOption } from "../components/passkey-option";
import { Wordmark } from "../components/wordmark";
import { Footer } from "../components/footer";
import { safeReturnTo } from "../lib/agent/paths";
import { subjectRedirect } from "../lib/onboarding-subject";
import { deadLinkMessage } from "../lib/login-link-error";
import { formMagicLinkRequest } from "../lib/auth/login-magic-link.server";
import { createAuthForRequest } from "../lib/auth.server";
import {
  clearAccountDeleteInstanceId,
  readAccountDeleteInstanceId,
  readAccountDeleteProgress,
} from "../lib/account-delete.server";
import { usePasskeySignIn } from "../lib/use-passkey-sign-in";
import { useTimezoneCookie } from "../lib/use-timezone-cookie";

type LoginActionData = { error: string; sent?: never } | { sent: { email: string; at: number }; error?: never };

function signInTarget(search: URLSearchParams): string {
  return safeReturnTo(search.get("next") ?? subjectRedirect(search.get("subject")));
}

export function meta() {
  return [{ title: "Sign in · Five to Nine" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const turnstileSiteKey = env.TURNSTILE_SITE_KEY;
  const search = new URL(request.url).searchParams;
  const linkError = deadLinkMessage(search);
  const id = search.get("deleted");
  if (id === null || id === "" || (await readAccountDeleteInstanceId(request)) !== id) {
    return data({ turnstileSiteKey, linkError, id: null, progress: null });
  }
  const progress = await readAccountDeleteProgress(id);
  const finished = progress?.files === "removed";
  const headers = finished ? { "set-cookie": await clearAccountDeleteInstanceId() } : undefined;
  return data({ turnstileSiteKey, linkError, id, progress }, { headers });
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const submitted = form.get("email");
  const email = typeof submitted === "string" ? submitted.trim().toLowerCase() : "";
  if (!email) return { error: "Enter your email address, then we'll send the link." };

  const captchaField = form.get("cf-turnstile-response");
  const captcha = typeof captchaField === "string" ? captchaField.trim() : "";
  const callbackURL = signInTarget(new URL(request.url).searchParams);
  const response = await (
    await createAuthForRequest(env, request)
  ).handler(formMagicLinkRequest({ authUrl: env.BETTER_AUTH_URL, request, email, captcha, callbackURL }));
  if (response.status === 200) return { sent: { email, at: Date.now() } };
  const detail = await response.text();
  if (response.status === 429) return { error: "Too many sign-in links. Wait a minute and try again." };
  if (detail.includes("Missing CAPTCHA response") || detail.includes("Captcha verification failed")) {
    return { error: "Confirm you're a person, then we'll send the link." };
  }
  if (response.status === 400) return { error: "Enter an email address we can send the link to." };
  console.error(JSON.stringify({ event: "login.magic_link_send_failed", status: response.status }));
  return data({ error: "We couldn't send the link. Try again in a minute." }, { status: 503 });
}

export default function Login() {
  const actionData = useActionData<LoginActionData>();
  const deleted = useLoaderData<typeof loader>();
  const busy = useNavigation().state !== "idle";
  const [searchParams] = useSearchParams();
  const passkey = usePasskeySignIn(signInTarget(searchParams));
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  useTimezoneCookie();

  const error = actionData?.error ?? deleted.linkError ?? "";

  const sent = actionData?.sent;
  if (sent && sent.at !== dismissedAt) {
    return (
      <SignInSent
        key={sent.at}
        email={sent.email}
        turnstileSiteKey={deleted.turnstileSiteKey}
        onChangeEmail={() => {
          setDismissedAt(sent.at);
        }}
      />
    );
  }

  return (
    <div className={SIGN_IN_SHELL}>
      <header className="self-start">
        <Wordmark />
      </header>
      <main className="flex flex-col">
        <h1 className={SIGN_IN_TITLE}>Sign in</h1>
        <p className={SIGN_IN_LEDE}>We email you a link. Tap it and you're in. There is no password.</p>
        {deleted.progress === null || deleted.id === null ? null : (
          <AccountDeleteNotice id={deleted.id} progress={deleted.progress} />
        )}
        <SignInError message={error} />
        <SignInEmailForm busy={busy} turnstileSiteKey={deleted.turnstileSiteKey} error={error} />
        <PasskeyOption state={passkey.state} onSignIn={passkey.signIn} />
      </main>
      <Footer />
    </div>
  );
}
