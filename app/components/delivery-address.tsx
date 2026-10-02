import { Form } from "react-router";

import { BLOCK_HEADING } from "./page-heading";
import { Button } from "./ui/button";

function describedByIds(hasError: boolean, showUnconfirmed: boolean): string | undefined {
  const ids = [
    hasError ? "delivery-address-error" : null,
    showUnconfirmed ? "delivery-address-unconfirmed" : null,
  ].filter((id) => id !== null);
  return ids.length === 0 ? undefined : ids.join(" ");
}

function AddressFields({
  delivery,
  error,
  suppressed,
}: {
  delivery: { address: string; verified: boolean };
  error: string | null;
  suppressed: boolean;
}) {
  const hasError = error !== null;
  const showUnconfirmed = !delivery.verified && !hasError;
  return (
    <>
      <input type="hidden" name="intent" value="delivery-address" />
      <label htmlFor="delivery-address-input" className="font-mono text-meta text-ink-soft uppercase">
        Send the brief to
      </label>
      <input
        id="delivery-address-input"
        name="address"
        type="email"
        autoComplete="email"
        required
        defaultValue={delivery.address}
        className="h-11 border border-line px-3"
        aria-invalid={hasError ? true : undefined}
        aria-describedby={describedByIds(hasError, showUnconfirmed)}
      />
      {showUnconfirmed ? (
        <p id="delivery-address-unconfirmed" className="mt-2 max-w-prose leading-[1.55]">
          This address isn't confirmed yet. We emailed you a confirmation link. The brief won't be sent until you
          confirm.
        </p>
      ) : null}
      {suppressed ? (
        <label className="flex min-h-11 items-center gap-3 leading-[1.55]">
          <input type="checkbox" name="resume" value="yes" className="size-5 shrink-0 accent-green" />
          Send the brief to this address again
        </label>
      ) : null}
      {hasError ? (
        <p id="delivery-address-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

export function DeliveryAddress({
  delivery,
  error,
  suppressed,
}: {
  delivery: { address: string; verified: boolean };
  error: string | null;
  suppressed: boolean;
}) {
  return (
    <section aria-labelledby="delivery-address" className="mt-10 border-t border-line pt-6">
      <h2 id="delivery-address" className={BLOCK_HEADING}>
        Delivery email
      </h2>
      <p className="mt-2 max-w-prose leading-[1.55]">The brief goes here. It starts as the address you sign in with.</p>
      <Form method="post" action="/app/settings" className="mt-4 flex flex-col gap-3">
        <AddressFields delivery={delivery} error={error} suppressed={suppressed} />
        <Button type="submit" variant="secondary" size="lg" className="self-start">
          Save
        </Button>
      </Form>
    </section>
  );
}
