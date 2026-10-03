import { Form, useNavigation } from "react-router";

import { BLOCK_HEADING } from "./page-heading";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function SignOut() {
  const navigation = useNavigation();
  const signingOut = navigation.state !== "idle" && navigation.formData?.get("intent") === "sign-out";
  return (
    <Form method="post" action="/app/settings">
      <input type="hidden" name="intent" value="sign-out" />
      <Button type="submit" variant="tertiary" disabled={signingOut}>
        {signingOut ? "Signing out…" : "Sign out"}
      </Button>
    </Form>
  );
}

export function ExportData() {
  return (
    <section aria-labelledby="export-data" className="mt-10 border-t border-line pt-4">
      <h2 id="export-data" className={BLOCK_HEADING}>
        Export your data
      </h2>
      <p className="mt-2 max-w-prose leading-[1.55]">
        One file with your brands, everything we found about them, and your brief history.
      </p>
      <a
        href="/app/settings/export"
        download
        className="mt-3 inline-flex min-h-11 items-center font-display font-bold underline decoration-1 underline-offset-4"
      >
        Download my data
      </a>
    </section>
  );
}

export function DeleteAccount({ email, error }: { email: string; error: string | null }) {
  const navigation = useNavigation();
  const working = navigation.state !== "idle" && navigation.formData?.get("intent") === "delete-account";
  return (
    <section aria-labelledby="delete-account" className="mt-10 border-t border-line pt-4">
      <h2 id="delete-account" className={BLOCK_HEADING}>
        Delete your account
      </h2>
      <p className="mt-2 max-w-prose leading-[1.55]">Deleting your account removes, for good:</p>
      <ul data-delete="removes" className="mt-2 flex max-w-prose list-disc flex-col gap-1 pl-5 leading-[1.55]">
        <li>Every brand you track, yours included</li>
        <li>Everything we found: site changes, ads, mentions and job listings</li>
        <li>Every saved copy of a website page</li>
        <li>Every screenshot</li>
        <li>Your shared ranking image</li>
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
          inputMode="email"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          aria-invalid={error === null ? undefined : true}
          aria-describedby={error === null ? undefined : "delete-account-error"}
        />
        {error === null ? null : (
          <p id="delete-account-error" role="alert" className="text-[0.95rem]">
            {error}
          </p>
        )}
        <Button type="submit" variant="secondary" size="lg" className="self-start border-red" disabled={working}>
          {working ? "Deleting…" : "Delete my account"}
        </Button>
      </Form>
    </section>
  );
}
