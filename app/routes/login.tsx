import type { Route } from "./+types/login";
import { env } from "cloudflare:workers";
import { useEffect, useState } from "react";
import { data, Form, useActionData, useLoaderData, useNavigate, useNavigation, useSearchParams } from "react-router";

import { AccountDeleteNotice } from "../components/account-delete-notice";
import { SIGN_IN_LEDE, SIGN_IN_SHELL, SIGN_IN_TITLE, SignInSent } from "../components/sign-in-sent";
import { TurnstileWidget } from "../components/turnstile-widget";
import { Wordmark } from "../components/wordmark";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Footer } from "../components/footer";
import { safeReturnTo } from "../lib/agent/paths";
import { subjectRedirect } from "../lib/onboarding-subject";
import { authClient } from "../lib/auth-client";
import { formMagicLinkRequest } from "../lib/auth/login-magic-link.server";
import { createAuthForRequest } from "../lib/auth.server";
import {
  clearAccountDeleteInstanceId,
  readAccountDeleteInstanceId,
  readAccountDeleteProgress,
} from "../lib/account-delete.server";
import { timezoneCookie } from "../lib/timezone";

type LoginActionData =
  | { error: string; sent?: never }
  | { sent: { email: string; at: number }; error?: never };

function signInTarget(search: URLSearchParams): string {
  return safeReturnTo(search.get("next") ?? subjectRedirect(search.get("subject")));
}

export function meta() {
  return [{ title: "Sign in · Five to Nine" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const turnstileSiteKey = env.TURNSTILE_SITE_KEY;
  const id = new URL(request.url).searchParams.get("deleted");
  if (id === null || id === "" || (await readAccountDeleteInstanceId(request)) !== id) {
    return data({ turnstileSiteKey, id: null, progress: null });
  }
  const progress = await readAccountDeleteProgress(id);
  const finished = progress?.files === "removed";
  const headers = finished ? { "set-cookie": await clearAccountDeleteInstanceId() } : undefined;
  return data({ turnstileSiteKey, id, progress }, { headers });
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const submitted = form.get("email");
  const email = typeof submitted === "string" ? submitted.trim().toLowerCase() : "";
  if (!email) return { error: "Enter your email address, then we'll send the link." };

  const captchaField = form.get("cf-turnstile-response");
  const captcha = typeof captchaField === "string" ? captchaField.trim() : "";
  const callbackURL = signInTarget(new URL(request.url).searchParams);
  const response = await (await createAuthForRequest(env, request)).handler(
    formMagicLinkRequest(env.BETTER_AUTH_URL, request, email, captcha, callbackURL),
  );
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
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [passkeyState, setPasskeyState] = useState<"idle" | "working" | "failed">("idle");

  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!zone) return;
    void timezoneCookie.serialize(zone, { secure: location.protocol === "https:" }).then((baked) => {
      document.cookie = baked;
    });
  }, []);

  async function signInWithPasskey() {
    setPasskeyState("working");
    const result = await authClient.signIn.passkey().catch((error: unknown) => {
      console.error(JSON.stringify({ event: "login.passkey_sign_in_failed", error: String(error) }));
      return null;
    });
    if (result && !result.error) {
      await navigate(signInTarget(searchParams));
      return;
    }
    const code = result?.error && "code" in result.error ? result.error.code : "";
    setPasskeyState(code === "AUTH_CANCELLED" ? "idle" : "failed");
  }

  if (actionData?.sent) {
    return <SignInSent key={actionData.sent.at} email={actionData.sent.email} turnstileSiteKey={deleted.turnstileSiteKey} />;
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
        {actionData?.error ? (
          <p role="alert" className="mt-8 text-[0.95rem]">
            {actionData.error}
          </p>
        ) : null}
        <Form method="post" className="mt-8 flex flex-col gap-3">
          <label htmlFor="email" className="font-mono text-eyebrow text-ink-soft uppercase">
            Email
          </label>
          <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required />
          <TurnstileWidget siteKey={deleted.turnstileSiteKey} startOn="email-focus" />
          <Button type="submit" size="lg" disabled={busy} className="mt-2">
            {busy ? "Sending…" : "Email me a link"}
          </Button>
        </Form>
        <Button
          type="button"
          variant="tertiary"
          className="mt-4 self-start"
          onClick={() => void signInWithPasskey()}
          disabled={passkeyState === "working"}
        >
          {passkeyState === "working" ? "Follow the prompt…" : "Use a passkey instead"}
        </Button>
        {passkeyState === "failed" ? (
          <p role="alert" className="text-[0.95rem]">
            Your passkey didn't sign you in. Try it again, or use the email link.
          </p>
        ) : null}
      </main>
      <Footer />
    </div>
  );
}
