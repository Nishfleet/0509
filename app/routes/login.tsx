import type { Route } from "./+types/login";
import { env } from "cloudflare:workers";
import { useContext, useEffect, useState } from "react";
import { Form, UNSAFE_FrameworkContext, useActionData, useNavigate, useNavigation, useSearchParams } from "react-router";

import { Footer } from "../components/footer";
import { SIGN_IN_LEDE, SIGN_IN_SHELL, SIGN_IN_TITLE, SignInSent } from "../components/sign-in-sent";
import { Wordmark } from "../components/wordmark";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { safeReturnTo } from "../lib/agent/paths";
import { authClient } from "../lib/auth-client";
import { handleAuthRequest } from "../lib/auth.server";
import { timezoneCookie } from "../lib/timezone";

const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js";

export function meta() {
  return [{ title: "Sign in · Five to Nine" }];
}

export function loader() {
  const siteKey = env.TURNSTILE_SITE_KEY;
  if (typeof siteKey !== "string" || siteKey.trim().length === 0) {
    throw new Response("misconfigured: TURNSTILE_SITE_KEY", { status: 503 });
  }
  return { turnstileSiteKey: siteKey.trim() };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const submitted = form.get("email");
  const email = typeof submitted === "string" ? submitted.trim().toLowerCase() : "";
  if (!email) return { error: "Enter your email address, then we'll send the link." };

  const captchaField = form.get("cf-turnstile-response");
  const captcha = typeof captchaField === "string" ? captchaField.trim() : "";
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  if (captcha.length > 0) headers.set("x-captcha-response", captcha);
  const response = await handleAuthRequest(
    env,
    new Request(new URL("/api/auth/sign-in/magic-link", request.url), {
      method: "POST",
      headers,
      body: JSON.stringify({
        email,
        callbackURL: safeReturnTo(new URL(request.url).searchParams.get("next")),
      }),
    }),
  );
  const status = response.status;
  await response.text();
  if (status === 400 || status === 403) {
    return { error: "Confirm you're a person, then we'll send the link." };
  }
  return { sent: { email, at: Date.now() } };
}

function TurnstileWidget({ siteKey }: { siteKey: string }) {
  const framework = useContext(UNSAFE_FrameworkContext);
  const nonce = framework === undefined ? undefined : framework.nonce;
  return (
    <>
      <div
        className="cf-turnstile"
        data-sitekey={siteKey}
        data-appearance="interaction-only"
        data-response-field="true"
        data-response-field-name="cf-turnstile-response"
      />
      <script nonce={nonce} src={TURNSTILE_SCRIPT} async defer suppressHydrationWarning />
    </>
  );
}

export default function Login({ loaderData }: Route.ComponentProps) {
  const data = useActionData<typeof action>();
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
    const result = await authClient.signIn.passkey().catch(() => null);
    if (result && !result.error) {
      await navigate(safeReturnTo(searchParams.get("next")));
      return;
    }
    const code = result?.error && "code" in result.error ? result.error.code : "";
    setPasskeyState(code === "AUTH_CANCELLED" ? "idle" : "failed");
  }

  if (data?.sent) {
    return <SignInSent key={data.sent.at} email={data.sent.email} />;
  }

  return (
    <div className={SIGN_IN_SHELL}>
      <header className="self-start">
        <Wordmark />
      </header>
      <main className="flex flex-col">
        <h1 className={SIGN_IN_TITLE}>Sign in</h1>
        <p className={SIGN_IN_LEDE}>We email you a link. Tap it and you're in. There is no password.</p>
        <Form method="post" className="mt-8 flex flex-col gap-3">
          <label htmlFor="email" className="font-mono text-eyebrow text-ink-soft uppercase">
            Email
          </label>
          <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required />
          <TurnstileWidget siteKey={loaderData.turnstileSiteKey} />
          <Button type="submit" size="lg" disabled={busy} className="mt-2">
            {busy ? "Sending…" : "Email me a link"}
          </Button>
        </Form>
        {data?.error ? (
          <p role="alert" className="mt-3 text-[0.95rem]">
            {data.error}
          </p>
        ) : null}
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
