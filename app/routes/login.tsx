import type { Route } from "./+types/login";
import { env } from "cloudflare:workers";
import { useEffect, useState } from "react";
import { Form, useActionData, useNavigate, useNavigation, useSearchParams } from "react-router";

import { Footer } from "../components/footer";
import { safeReturnTo } from "../lib/agent/paths";
import { authClient } from "../lib/auth-client";
import { createAuth } from "../lib/auth.server";
import { timezoneCookie } from "../lib/timezone";

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const submitted = form.get("email");
  const email = typeof submitted === "string" ? submitted.trim().toLowerCase() : "";
  if (!email) return { error: "Enter your email." };

  const auth = createAuth(env);
  await auth.api
    .signInMagicLink({
      body: { email, callbackURL: safeReturnTo(new URL(request.url).searchParams.get("next")) },
      headers: request.headers,
    })
    .catch(() => undefined);

  return { sent: true };
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

  if (data && "sent" in data) {
    return (
      <main>
        <h1>Check your email</h1>
        <p>If that address can sign in, a link is on its way. It works once and expires shortly.</p>
        <Footer />
      </main>
    );
  }

  return (
    <main>
      <h1>Sign in</h1>
      <Form method="post">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
        <button type="submit" disabled={busy}>{busy ? "Sending…" : "Send me a link"}</button>
      </Form>
      <button type="button" onClick={() => void signInWithPasskey()} disabled={passkeyState === "working"}>
        {passkeyState === "working" ? "Follow the prompt…" : "Sign in with a passkey"}
      </button>
      {passkeyState === "failed" ? (
        <p role="alert">Passkey sign-in did not go through. Try again or use your email link.</p>
      ) : null}
      {data && "error" in data ? <p role="alert">{data.error}</p> : null}
      <Footer />
    </main>
  );
}
