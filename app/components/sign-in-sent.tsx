import { useEffect, useRef, useState } from "react";
import { useNavigation, useSubmit } from "react-router";

import { MAGIC_LINK_TTL_SECONDS } from "../lib/auth/magic-link-email";
import { BRAND_NAME_SHAPE } from "../lib/identity/brand-name";
import { inboxLinkFor } from "../lib/inbox-link";
import { cn } from "../lib/utils";
import { Footer } from "./footer";
import { TurnstileWidget, turnstileResponse } from "./turnstile-widget";
import { Button, buttonVariants } from "./ui/button";
import { Wordmark } from "./wordmark";

const RESEND_AFTER_SECONDS = 30;

export const SIGN_IN_SHELL = "mx-auto flex min-h-dvh w-full max-w-[420px] min-w-0 flex-col justify-center px-5 py-12";
export const SIGN_IN_TITLE = "font-display text-display-2 mt-10 font-extrabold uppercase";
export const SIGN_IN_LEDE = "text-ink-soft mt-3 leading-[1.55] [overflow-wrap:anywhere]";

export function subjectLabel(raw: string | null): string | null {
  const text = (raw ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/[/?#].*$/, "");
  return BRAND_NAME_SHAPE.test(text) ? text : null;
}

export function SignInHeading({ subject }: { subject: string | null }) {
  if (subject === null) {
    return (
      <>
        <h1 className={SIGN_IN_TITLE}>Sign in</h1>
        <p className={SIGN_IN_LEDE}>
          New or returning, we email you a link. Tap it and you're in. There is no password.
        </p>
      </>
    );
  }
  return (
    <>
      <h1 className={cn(SIGN_IN_TITLE, "[overflow-wrap:anywhere]")}>Start watching {subject}</h1>
      <p className={SIGN_IN_LEDE}>Enter your email. We'll send a link that creates your account. No password.</p>
    </>
  );
}

export function SignInSent({
  email,
  turnstileSiteKey,
  onChangeEmail,
}: {
  email: string;
  turnstileSiteKey: string;
  onChangeEmail: () => void;
}) {
  const minutes = String(MAGIC_LINK_TTL_SECONDS / 60);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <div className={SIGN_IN_SHELL}>
      <header className="self-start">
        <Wordmark />
      </header>
      <main className="flex flex-col">
        <h1 ref={heading} tabIndex={-1} className={cn(SIGN_IN_TITLE, "outline-none")}>
          Check your email
        </h1>
        <p className={SIGN_IN_LEDE}>
          We sent a sign-in link to <strong className="font-semibold text-ink">{email}</strong>. Check spam if you don't
          see it within a minute. It works once and expires in {minutes} minutes.
        </p>
        <TurnstileWidget siteKey={turnstileSiteKey} />
        <OpenInbox email={email} />
        <ResendControls email={email} onChangeEmail={onChangeEmail} />
      </main>
      <Footer />
    </div>
  );
}

function OpenInbox({ email }: { email: string }) {
  const inbox = inboxLinkFor(email);
  if (inbox === null) return null;
  return (
    <a
      href={inbox.href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${inbox.name} (opens in a new tab)`}
      className={cn(buttonVariants({ variant: "primary", size: "lg" }), "mt-8 self-start")}
    >
      Open {inbox.name}
    </a>
  );
}

function ResendControls({ email, onChangeEmail }: { email: string; onChangeEmail: () => void }) {
  const submit = useSubmit();
  const busy = useNavigation().state !== "idle";
  const wait = useCountdown(RESEND_AFTER_SECONDS);
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="lg"
        className={cn("self-start", inboxLinkFor(email) === null ? "mt-8" : "mt-3")}
        disabled={wait > 0 || busy}
        onClick={() => void submit({ email, "cf-turnstile-response": turnstileResponse() }, { method: "post" })}
      >
        {wait > 0 ? `Send it again in ${String(wait)}s` : busy ? "Sending…" : "Send it again"}
      </Button>
      <Button type="button" variant="tertiary" className="mt-2 self-start" onClick={onChangeEmail}>
        Use a different email
      </Button>
      <p role="status" className="sr-only">
        {wait > 0 ? `You can send it again in ${String(RESEND_AFTER_SECONDS)} seconds.` : "You can send it again now."}
      </p>
    </>
  );
}

function useCountdown(from: number): number {
  const [seconds, setSeconds] = useState(from);
  useEffect(() => {
    const id = setInterval(() => {
      setSeconds((left) => Math.max(0, left - 1));
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, []);
  return seconds;
}
