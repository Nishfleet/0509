import { Form } from "react-router";

import { Button } from "./ui/button";

export function SignOut() {
  return (
    <Form method="post" action="/app/settings">
      <input type="hidden" name="intent" value="sign-out" />
      <Button type="submit" variant="outline" size="lg">
        Sign out
      </Button>
    </Form>
  );
}

export function DeleteAccount({ email, error }: { email: string; error: string | null }) {
  return (
    <section aria-labelledby="delete-account" className="border-line mt-10 border-t pt-6">
      <h2 id="delete-account" className="font-display text-lg font-semibold">
        Delete your account
      </h2>
      <p className="mt-2 leading-[1.65]">
        This deletes your workspace, every competitor, change, screenshot and brief, your API keys and connected apps.
        The emails stop. It can't be undone.
      </p>
      <Form method="post" action="/app/settings" className="mt-4 flex flex-col gap-3">
        <input type="hidden" name="intent" value="delete-account" />
        <label htmlFor="confirm-email" className="leading-[1.65]">
          Type {email} to confirm
        </label>
        <input
          id="confirm-email"
          name="confirm"
          type="email"
          autoComplete="off"
          required
          aria-invalid={error === null ? undefined : true}
          aria-describedby={error === null ? undefined : "delete-account-error"}
          className="border-line h-11 border px-3"
        />
        {error === null ? null : (
          <p id="delete-account-error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="destructive" size="lg" className="self-start">
          Delete my account
        </Button>
      </Form>
    </section>
  );
}
