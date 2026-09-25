import { Form } from "react-router";

import { BLOCK_HEADING } from "./page-heading";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function SignOut() {
  return (
    <Form method="post" action="/app/settings">
      <input type="hidden" name="intent" value="sign-out" />
      <Button type="submit" variant="tertiary">
        Sign out
      </Button>
    </Form>
  );
}

export function DeleteAccount({ email, error }: { email: string; error: string | null }) {
  return (
    <section aria-labelledby="delete-account" className="border-line mt-10 border-t pt-4">
      <h2 id="delete-account" className={BLOCK_HEADING}>
        Delete your account
      </h2>
      <p className="mt-2 max-w-prose leading-[1.55]">
        This deletes your workspace, every competitor, change, screenshot and brief, your API keys and connected apps.
        The emails stop. It can't be undone.
      </p>
      <Form method="post" action="/app/settings" className="mt-4 flex flex-col gap-3">
        <input type="hidden" name="intent" value="delete-account" />
        <label htmlFor="confirm-email" className="leading-[1.55] [overflow-wrap:anywhere]">
          Type {email} to confirm
        </label>
        <Input
          id="confirm-email"
          name="confirm"
          type="email"
          autoComplete="off"
          required
          aria-invalid={error === null ? undefined : true}
          aria-describedby={error === null ? undefined : "delete-account-error"}
        />
        {error === null ? null : (
          <p id="delete-account-error" role="alert" className="text-[0.95rem]">
            {error}
          </p>
        )}
        <Button type="submit" variant="secondary" size="lg" className="border-red self-start">
          Delete my account
        </Button>
      </Form>
    </section>
  );
}
