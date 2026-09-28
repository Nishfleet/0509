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
      <p className="mt-2 max-w-prose leading-[1.55]">Deleting your account removes, for good:</p>
      <ul
        data-delete="removes"
        className="mt-2 flex max-w-prose list-disc flex-col gap-1 pl-5 leading-[1.55]"
      >
        <li>Every brand you track, yours included</li>
        <li>Every signal: site changes, ads, mentions and roles</li>
        <li>Every site snapshot</li>
        <li>Every screenshot</li>
        <li>Your published standing card</li>
        <li>Your send history and every brief</li>
        <li>Your account, its API keys and connected AI apps</li>
      </ul>
      <p className="mt-2 max-w-prose leading-[1.55]">The emails stop. This can't be undone.</p>
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
