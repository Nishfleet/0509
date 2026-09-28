import { Form } from "react-router";

import { BLOCK_HEADING } from "./page-heading";
import { Button } from "./ui/button";

export function DeliveryAddress({
  address,
  error,
  suppressed,
}: {
  address: string;
  error: string | null;
  suppressed: boolean;
}) {
  const hasError = error !== null;
  return (
    <section aria-labelledby="delivery-address" className="border-line mt-10 border-t pt-6">
      <h2 id="delivery-address" className={BLOCK_HEADING}>
        Delivery email
      </h2>
      <p className="mt-2 max-w-prose leading-[1.55]">
        The brief goes here. It starts as the address you sign in with.
      </p>
      <Form method="post" action="/app/settings" className="mt-4 flex flex-col gap-3">
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
          defaultValue={address}
          className="border-line h-11 border px-3"
          aria-invalid={hasError ? true : undefined}
          aria-describedby={hasError ? "delivery-address-error" : undefined}
        />
        {suppressed ? (
          <label className="leading-[1.55]">
            <input type="checkbox" name="resume" value="yes" className="mr-2" />
            Send to it again
          </label>
        ) : null}
        {hasError ? (
          <p id="delivery-address-error" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="secondary" size="lg" className="self-start">
          Save
        </Button>
      </Form>
    </section>
  );
}
