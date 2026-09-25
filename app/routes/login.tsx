import type { Route } from "./+types/login";
import { env } from "cloudflare:workers";
import { useEffect, useState } from "react";
import { Link, Form, useActionData, useLoaderData, useNavigate, useNavigation, useSearchParams } from "react-router";

import { Footer, SUPPORT_ADDRESS } from "../components/footer";
import { SIGN_IN_LEDE, SIGN_IN_SHELL, SIGN_IN_TITLE, SignInSent } from "../components/sign-in-sent";
import { Wordmark } from "../components/wordmark";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { safeReturnTo } from "../lib/agent/paths";
import { authClient } from "../lib/auth-client";
import { createAuth } from "../lib/auth.server";
import { timezoneCookie } from "../lib/timezone";
import { readAccountDeleteProgress } from "../lib/account-delete.server";

export function meta() {
  return [{ title: "Sign in · Five to Nine" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const id = new URL(request.url).searchParams.get("deleted");
  if (id === null || id === "") return { id: null, progress: null };
  return { id, progress: await readAccountDeleteProgress(id) };
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
    .catch((error: unknown) => {
      console.error(JSON.stringify({ event: "login.magic_link_send_failed", error: String(error) }));
    });

  return { sent: { email, at: Date.now() } };
}

export default function Login() {
  const data = useActionData<typeof action>();
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
        {deleted.progress === null ? null : (
          <section data-delete="progress" aria-live="polite">
            <h2 className={SIGN_IN_TITLE}>Your account is deleted</h2>
            <ul className={SIGN_IN_LEDE}>
              <li>Brands, signals, briefs, send history, card, API keys and connected apps: removed</li>
              <li>
                {deleted.progress.files === "removing"
                  ? "Snapshots and screenshots: still removing"
                  : deleted.progress.files === "failed"
                    ? `Snapshots and screenshots: stopped. Write to ${SUPPORT_ADDRESS} and we'll finish it.`
                    : deleted.progress.deleted === null
                      ? "Snapshots and screenshots: removed"
                      : `Snapshots and screenshots: removed (${String(deleted.progress.deleted)} files)`}
              </li>
            </ul>
            {deleted.progress.files === "removing" ? (
              <Link to={`/login?deleted=${encodeURIComponent(deleted.id)}`} className={SIGN_IN_LEDE}>
                Check again
              </Link>
            ) : null}
          </section>
        )}
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
      </main>
      <Footer />
    </div>
  );
}
