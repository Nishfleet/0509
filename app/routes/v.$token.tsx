import type { Route } from "./+types/v.$token";
import { Form } from "react-router";

import { Footer } from "../components/footer";
import { Button } from "../components/ui/button";
import { confirmDeliveryAddress } from "../lib/verify-delivery-address.server";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Confirm your delivery email — Five to Nine" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export function headers(_: Route.HeadersArgs) {
  return { "Cache-Control": "no-store" };
}

export async function action({ params }: Route.ActionArgs) {
  await confirmDeliveryAddress(params.token);
  return { confirmed: true as const };
}

export default function VerifyAddress({ actionData }: Route.ComponentProps) {
  if (actionData?.confirmed) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16">
        <h1 className="font-display text-2xl font-semibold tracking-[-0.02em]">Address confirmed</h1>
        <p className="text-ink-soft mt-4 leading-[1.65]">The brief now goes to this address.</p>
        <Footer />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 className="font-display text-2xl font-semibold tracking-[-0.02em]">
        Confirm this address for your brief?
      </h1>
      <p className="text-ink-soft mt-4 leading-[1.65]">
        The weekly brief and any alerts go to this address once you confirm. If you did not ask for
        this, ignore this page.
      </p>
      <Form method="post" className="mt-8">
        <Button type="submit" size="lg">
          Confirm address
        </Button>
      </Form>
      <Footer />
    </main>
  );
}
