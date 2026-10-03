import { Form } from "react-router";

import { TurnstileWidget } from "./turnstile-widget";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export const SIGN_IN_ERROR_ID = "sign-in-error";

export function SignInError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p id={SIGN_IN_ERROR_ID} role="alert" className="mt-8 text-[0.95rem]">
      {message}
    </p>
  );
}

export function SignInEmailForm({
  busy,
  turnstileSiteKey,
  error,
}: {
  busy: boolean;
  turnstileSiteKey: string;
  error: string;
}) {
  const hasError = error !== "";
  return (
    <Form method="post" className="mt-8 flex flex-col gap-3">
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
        aria-invalid={hasError ? true : undefined}
        aria-describedby={hasError ? SIGN_IN_ERROR_ID : undefined}
      />
      <TurnstileWidget siteKey={turnstileSiteKey} startOn="email-focus" />
      <Button type="submit" size="lg" disabled={busy} className="mt-2">
        {busy ? "Sending…" : "Send sign-in link"}
      </Button>
    </Form>
  );
}
