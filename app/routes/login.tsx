import type { Route } from "./+types/login";
import { env } from "cloudflare:workers";
import { useEffect, useState } from "react";
import { Form, useActionData, useNavigate, useNavigation, useSearchParams } from "react-router";

import { Footer } from "../components/footer";
import { SIGN_IN_LEDE, SIGN_IN_SHELL, SIGN_IN_TITLE, SignInSent } from "../components/sign-in-sent";
import { Wordmark } from "../components/wordmark";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { safeReturnTo } from "../lib/agent/paths";
import { authClient } from "../lib/auth-client";
import { createAuth } from "../lib/auth.server";
import { timezoneCookie } from "../lib/timezone";


export function meta() {
  return [{ title: "Sign in · Five to Nine" }];
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const submitted = form.get("email");
  const email = typeof submitted === "string" ? submitted.trim().toLowerCase() : "";
  if (!email) return { error: "Enter your email address, then we'll send the link." };

  const auth = createAuth(env);
  await auth.api
    .signInMagicLink({
      body: { email, callbackURL: safeReturnTo(new URL(request.url).searchParams.get("next")) },
      headers: request.headers,
    })
    .catch(() => undefined);

  return { sent: { email, at: Date.now() } };
}

export default function Login() {
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
    return <SignInSent email={data.sent.email} sentAt={data.sent.at} />;
  }

  return (
    <main className={SIGN_IN_SHELL}>
      <Wordmark className="self-start" />
      <h1 className={SIGN_IN_TITLE}>Sign in</h1>
      <p className={SIGN_IN_LEDE}>We email you a link. Tap it and you're in. There is no password.</p>
      <Form method="post" className="mt-8 flex flex-col gap-3">
        <label htmlFor="email" className="font-mono text-eyebrow text-ink-soft uppercase">
          Email
        </label>
        <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required />
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
      <Footer />
    </main>
  );
}
