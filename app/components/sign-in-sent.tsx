import { useEffect, useState } from "react";
import { useNavigation, useSubmit } from "react-router";

import { MAGIC_LINK_TTL_SECONDS } from "../lib/auth/magic-link-email";
import { Footer } from "./footer";
import { Button } from "./ui/button";
import { Wordmark } from "./wordmark";

const RESEND_AFTER_SECONDS = 30;

export const SIGN_IN_SHELL = "mx-auto flex min-h-dvh w-full max-w-[420px] min-w-0 flex-col justify-center px-5 py-12";
export const SIGN_IN_TITLE = "font-display text-display-2 mt-10 font-extrabold uppercase";
export const SIGN_IN_LEDE = "text-ink-soft mt-3 leading-[1.55] [overflow-wrap:anywhere]";

export function SignInSent({ email, sentAt }: { email: string; sentAt: number }) {
  const submit = useSubmit();
  const busy = useNavigation().state !== "idle";
  const wait = useSecondsLeft(sentAt);
  const minutes = String(MAGIC_LINK_TTL_SECONDS / 60);

  return (
    <main className={SIGN_IN_SHELL}>
      <Wordmark className="self-start" />
      <h1 className={SIGN_IN_TITLE}>Check your email</h1>
      <p className={SIGN_IN_LEDE}>
        If <strong className="text-ink font-semibold">{email}</strong> can sign in, a link is on its way. It works
        once and expires in {minutes} minutes.
      </p>
      <Button
        type="button"
        variant="secondary"
        size="lg"
        className="mt-8 self-start"
        disabled={wait > 0 || busy}
        onClick={() => void submit({ email }, { method: "post" })}
      >
        {wait > 0 ? `Send it again in ${String(wait)}s` : busy ? "Sending…" : "Send it again"}
      </Button>
      <Footer />
    </main>
  );
}

function secondsLeft(since: number): number {
  return Math.max(0, RESEND_AFTER_SECONDS - Math.floor((Date.now() - since) / 1000));
}

function useSecondsLeft(since: number): number {
  const [seconds, setSeconds] = useState(() => secondsLeft(since));
  useEffect(() => {
    const id = setInterval(() => {
      setSeconds(secondsLeft(since));
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, [since]);
  return seconds;
}
