import type { Route } from "./+types/login";
import { env } from "cloudflare:workers";
import { useEffect, useState } from "react";
import { Form, useActionData, useFetcher, useNavigate, useNavigation } from "react-router";

import { Footer } from "../components/footer";
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
    .signInMagicLink({ body: { email, callbackURL: "/app" }, headers: request.headers })
    .catch(() => undefined);

  return { sent: true, email };
}

export default function Login() {
  const data = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const [passkeyState, setPasskeyState] = useState<"idle" | "working" | "failed">("idle");
  const [wait, setWait] = useState(30);

  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!zone) return;
    void timezoneCookie.serialize(zone, { secure: location.protocol === "https:" }).then((baked) => {
      document.cookie = baked;
    });
  }, []);

  useEffect(() => {
    if (!(data && "sent" in data) || wait <= 0) return;
    const timer = setTimeout(() => {
      setWait(wait - 1);
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [data, wait]);

  async function signInWithPasskey() {
    setPasskeyState("working");
    const result = await authClient.signIn.passkey().catch(() => null);
    if (result && !result.error) {
      await navigate("/app");
      return;
    }
    const code = result?.error && "code" in result.error ? result.error.code : "";
    setPasskeyState(code === "AUTH_CANCELLED" ? "idle" : "failed");
  }

  if (data && "sent" in data) {
    const { email } = data;
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col justify-center gap-6 px-6 bg-bone text-ink">
        <p className="font-mono text-sm">Five to Nine</p>
        <h1>Check your email</h1>
        <p>If {email} can sign in, a link is on its way. It works once and lasts 5 minutes.</p>
        <button
          type="button"
          disabled={wait > 0}
          onClick={() => {
            setWait(30);
            void fetcher.submit({ email }, { method: "post" });
          }}
        >
          {wait > 0 ? `Send it again in ${String(wait)}s` : "Send it again"}
        </button>
        <Footer />
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col justify-center gap-6 px-6 bg-bone text-ink">
      <p className="font-mono text-sm">Five to Nine</p>
      <h1>We'll email you a link to sign in.</h1>
      <Form method="post">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="w-full border border-line px-3 py-3"
        />
        <button type="submit" disabled={busy} className="w-full bg-ink px-4 py-3 text-bone">
          {busy ? "Sending…" : "Email me a link"}
        </button>
      </Form>
      <button
        type="button"
        onClick={() => void signInWithPasskey()}
        disabled={passkeyState === "working"}
        className="self-start text-sm text-ink-soft underline"
      >
        {passkeyState === "working" ? "Follow the prompt…" : "use a passkey instead"}
      </button>
      {passkeyState === "failed" ? (
        <p role="alert">Passkey sign-in did not go through. Try again or use your email link.</p>
      ) : null}
      {data && "error" in data ? <p role="alert">{data.error}</p> : null}
      <Footer />
    </main>
  );
}
