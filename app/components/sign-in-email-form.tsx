import { useCallback, useEffect, useRef, useState, type SubmitEvent } from "react";
import { Form } from "react-router";

import { TurnstileWidget, type CaptchaState } from "./turnstile-widget";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export const SIGN_IN_ERROR_ID = "sign-in-error";

export const CAPTCHA_PENDING_MESSAGE = "Still checking you're a person. Give it a few seconds, then tap again.";

const CAPTCHA_WAIT_MS = 10_000;

export type SendPhase = CaptchaState | "waiting";

export function nextPhase(phase: SendPhase, event: CaptchaState | "tap"): SendPhase {
  if (event === "tap") return phase === "checking" ? "waiting" : phase;
  if (event === "checking") return phase === "waiting" ? "waiting" : "checking";
  return event;
}

function holdsSend(phase: SendPhase): boolean {
  return phase === "checking" || phase === "waiting";
}

export function SignInError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p id={SIGN_IN_ERROR_ID} role="alert" className="mt-8 text-[0.95rem]">
      {message}
    </p>
  );
}

function useSendPhase(initialPhase: SendPhase) {
  const [phase, setPhase] = useState<SendPhase>(initialPhase);
  const form = useRef<HTMLFormElement>(null);
  const queued = useRef(false);
  const held = holdsSend(phase);
  const waiting = phase === "waiting";
  const report = useCallback((state: CaptchaState) => {
    setPhase((current) => nextPhase(current, state));
  }, []);

  useEffect(() => {
    if (!held) return;
    const timer = setTimeout(() => {
      report("unavailable");
    }, CAPTCHA_WAIT_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [held, report]);

  useEffect(() => {
    if (waiting) queued.current = true;
    else if (queued.current && !held) {
      queued.current = false;
      form.current?.requestSubmit();
    }
  }, [waiting, held]);

  const onSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    if (!held) return;
    event.preventDefault();
    setPhase((current) => nextPhase(current, "tap"));
  };
  return { form, waiting, report, onSubmit };
}

export function SignInEmailForm({
  busy,
  turnstileSiteKey,
  error,
  initialPhase = "checking",
}: {
  busy: boolean;
  turnstileSiteKey: string;
  error: string;
  initialPhase?: SendPhase;
}) {
  const { form, waiting, report, onSubmit } = useSendPhase(initialPhase);
  const hasError = error !== "";
  return (
    <Form ref={form} method="post" className="mt-8 flex flex-col gap-3" onSubmit={onSubmit}>
      <label htmlFor="email" className="font-mono text-eyebrow text-ink-soft uppercase">
        Email
      </label>
      <Input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        aria-invalid={hasError && error !== CAPTCHA_PENDING_MESSAGE ? true : undefined}
        aria-describedby={hasError ? SIGN_IN_ERROR_ID : undefined}
      />
      <TurnstileWidget siteKey={turnstileSiteKey} onState={report} />
      <Button
        type="submit"
        size="lg"
        disabled={busy}
        aria-disabled={waiting ? true : undefined}
        className="mt-2 aria-disabled:opacity-60"
      >
        {busy ? "Sending…" : waiting ? "Checking you're a person…" : "Send sign-in link"}
      </Button>
    </Form>
  );
}
