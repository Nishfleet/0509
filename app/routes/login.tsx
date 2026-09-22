import type { Route } from "./+types/login";
import { env } from "cloudflare:workers";
import { useEffect, useState } from "react";
import { Form, useActionData, useNavigate, useNavigation, useSubmit } from "react-router";

import { authClient } from "../lib/auth-client";
import { createAuth } from "../lib/auth.server";
import { timezoneCookie } from "../lib/timezone";

const RESEND_SECONDS = 30;
const LINK_MINUTES = 5;
const headingClass = "font-display mt-8 text-[1.15rem] leading-[1.1] font-bold tracking-[0.02em] uppercase";

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const submitted = form.get("email");
  const email = typeof submitted === "string" ? submitted.trim().toLowerCase() : "";
  if (!email) return { error: "Enter your email." };
  const auth = createAuth(env);
  await auth.api
    .signInMagicLink({ body: { email, callbackURL: "/app" }, headers: request.headers })
    .catch(() => undefined);
  return { sent: true as const, email, sentAt: Date.now() };
}

function Wordmark() {
  return (
    <p className="font-display text-[1.05rem] leading-none font-extrabold tracking-[-0.03em] uppercase">
      05<span className="bg-accent text-on-accent px-[5px]">09</span>
    </p>
  );
}

function Sent({ email, busy, onResend }: { email: string; busy: boolean; onResend: (email: string) => void }) {
  const [remaining, setRemaining] = useState(RESEND_SECONDS);
  useEffect(() => {
    let current = RESEND_SECONDS;
    const id = window.setInterval(() => {
      current -= 1;
      if (current <= 0) {
        window.clearInterval(id);
        setRemaining(0);
        return;
      }
      setRemaining(current);
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, []);
  return (
    <>
      <h1 className={headingClass}>A link is on its way</h1>
      <p className="text-ink-soft mt-4 text-base leading-[1.55] [overflow-wrap:anywhere]">
        Sent to {email}. It works once and lasts {LINK_MINUTES} minutes.
      </p>
      <button
        type="button"
        className="bg-ink text-bone font-display mt-6 min-h-11 w-full rounded-none border-[1.5px] border-ink px-4 text-base font-bold disabled:bg-card disabled:text-ink-soft disabled:border-line"
        disabled={remaining > 0 || busy}
        onClick={() => {
          onResend(email);
        }}
      >
        send it again
        {remaining > 0 ? <span className="text-ink ml-3 font-mono tabular-nums">{remaining}</span> : null}
      </button>
    </>
  );
}

export default function Login() {
  const data = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  const navigate = useNavigate();
  const submit = useSubmit();
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
      await navigate("/app");
      return;
    }
    const code = result?.error && "code" in result.error ? result.error.code : "";
    setPasskeyState(code === "AUTH_CANCELLED" ? "idle" : "failed");
  }
  function resend(email: string) {
    const body = new FormData();
    body.set("email", email);
    void submit(body, { method: "post" });
  }
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="w-full max-w-[420px] min-w-0">
        <Wordmark />
        {data && "sent" in data ? (
          <Sent key={data.sentAt} email={data.email} busy={busy} onResend={resend} />
        ) : (
          <>
            <h1 className={headingClass}>We&apos;ll email you a link</h1>
            <Form method="post" className="mt-6">
              <label htmlFor="email" className="text-ink-soft font-mono text-[0.72rem] tracking-[0.16em] uppercase">
                Email
              </label>
              <input id="email" name="email" type="email" autoComplete="email" required className="bg-card text-ink mt-2 min-h-11 w-full rounded-none border-[1.5px] border-ink px-3 text-base" />
              <button type="submit" disabled={busy} className="bg-ink text-bone font-display mt-4 min-h-11 w-full rounded-none border-0 px-4 text-base font-bold">
                {busy ? "Sending…" : "Email me a link"}
              </button>
            </Form>
            <button
              type="button"
              className="text-ink-soft mt-4 min-h-11 w-full rounded-none border-0 bg-transparent font-mono text-[0.72rem] underline underline-offset-4"
              onClick={() => {
                void signInWithPasskey();
              }}
              disabled={passkeyState === "working"}
            >
              {passkeyState === "working" ? "Follow the prompt…" : "use a passkey instead"}
            </button>
            {passkeyState === "failed" ? (
              <p role="alert" className="mt-3 text-[0.88rem] leading-[1.5]">Passkey sign-in did not go through. Try again or use your email link.</p>
            ) : null}
            {data && "error" in data ? <p role="alert" className="mt-3 text-[0.88rem] leading-[1.5]">{data.error}</p> : null}
          </>
        )}
      </div>
    </main>
  );
}
