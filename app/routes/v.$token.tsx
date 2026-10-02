import type { Route } from "./+types/v.$token";
import { Form, useNavigation } from "react-router";

import { Footer } from "../components/footer";
import { Button } from "../components/ui/button";
import { confirmDeliveryAddress } from "../lib/verify-delivery-address.server";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Confirm your email address · Five to Nine" }, { name: "robots", content: "noindex, nofollow" }];
}

export function headers(_: Route.HeadersArgs) {
  return { "Cache-Control": "no-store" };
}

export async function action({ params }: Route.ActionArgs) {
  await confirmDeliveryAddress(params.token);
  return { confirmed: true as const };
}

export default function VerifyAddress({ actionData }: Route.ComponentProps) {
  const confirming = useNavigation().state !== "idle";
  if (actionData?.confirmed) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16">
        <h1 className="font-display text-2xl font-semibold tracking-[-0.02em]">Email address confirmed</h1>
        <p className="mt-4 leading-[1.65] text-ink-soft">
          Your weekly brief and alerts will now go to this email address.
        </p>
        <Footer />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 className="font-display text-2xl font-semibold tracking-[-0.02em]">Confirm this email address?</h1>
      <p className="mt-4 leading-[1.65] text-ink-soft">
        Your weekly brief and alerts will go to this email address once you confirm. If you did not ask for this, you
        can close this page.
      </p>
      <Form method="post" className="mt-8">
        <Button type="submit" size="lg" disabled={confirming}>
          {confirming ? "Confirming…" : "Confirm email address"}
        </Button>
      </Form>
      <Footer />
    </main>
  );
}
