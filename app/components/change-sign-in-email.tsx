import { Form, useNavigation } from "react-router";

import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function ChangeSignInEmail({ sent, error }: { sent: boolean; error: string | null }) {
  const navigation = useNavigation();
  const sending = navigation.state !== "idle" && navigation.formData?.get("intent") === "change-email";
  return (
    <Form method="post" action="/app/settings" className="mt-4 flex flex-col gap-3">
      <input type="hidden" name="intent" value="change-email" />
      <label htmlFor="new-sign-in-email" className="font-mono text-meta text-ink-soft uppercase">
        Change the email you sign in with
      </label>
      <Input
        id="new-sign-in-email"
        name="newEmail"
        type="email"
        autoComplete="off"
        inputMode="email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
        aria-invalid={error === null ? undefined : true}
        aria-describedby={error === null ? undefined : "new-sign-in-email-error"}
      />
      {sent ? (
        <p role="status" className="max-w-prose leading-[1.55]">
          Check that inbox. If the address can be used, we've sent a confirmation link. Nothing changes until you open
          it.
        </p>
      ) : null}
      {error === null ? null : (
        <p id="new-sign-in-email-error" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" variant="secondary" size="lg" className="self-start" disabled={sending}>
        {sending ? "Sending…" : "Send confirmation link"}
      </Button>
    </Form>
  );
}
