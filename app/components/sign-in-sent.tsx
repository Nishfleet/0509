import { useEffect, useRef, useState } from "react";
import { useNavigation, useSubmit } from "react-router";

import { MAGIC_LINK_TTL_SECONDS } from "../lib/auth/magic-link-email";
import { cn } from "../lib/utils";
import { Footer } from "./footer";
import { Button } from "./ui/button";
import { Wordmark } from "./wordmark";

const RESEND_AFTER_SECONDS = 30;

export const SIGN_IN_SHELL = "mx-auto flex min-h-dvh w-full max-w-[420px] min-w-0 flex-col justify-center px-5 py-12";
export const SIGN_IN_TITLE = "font-display text-display-2 mt-10 font-extrabold uppercase";
export const SIGN_IN_LEDE = "text-ink-soft mt-3 leading-[1.55] [overflow-wrap:anywhere]";

export function SignInSent({ email }: { email: string }) {
  const submit = useSubmit();
  const busy = useNavigation().state !== "idle";
  const wait = useCountdown(RESEND_AFTER_SECONDS);
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
        <p role="status" className="sr-only">
          {wait > 0
            ? `You can send it again in ${String(RESEND_AFTER_SECONDS)} seconds.`
            : "You can send it again now."}
        </p>
      </main>
      <Footer />
    </div>
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
