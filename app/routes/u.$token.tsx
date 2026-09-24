import type { Route } from "./+types/u.$token";
import { Form } from "react-router";

import { Footer } from "../components/footer";
import { Button } from "../components/ui/button";
import { unsubscribe } from "../lib/unsubscribe.server";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Unsubscribe — Five to Nine" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export function headers(_: Route.HeadersArgs) {
  return { "Cache-Control": "no-store" };
}

export async function action({ params }: Route.ActionArgs) {
  await unsubscribe(params.token);
  return { unsubscribed: true };
}

export default function Unsubscribe({ actionData }: Route.ComponentProps) {
  if (actionData?.unsubscribed) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16">
        <h1 className="font-display text-2xl font-semibold tracking-[-0.02em]">You're unsubscribed</h1>
        <p className="text-ink-soft mt-4 leading-[1.65]">No more email will be sent to this address.</p>
        <Footer />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 className="font-display text-2xl font-semibold tracking-[-0.02em]">Stop the weekly brief?</h1>
      <p className="text-ink-soft mt-4 leading-[1.65]">
        This stops every email from Five to Nine to this address.
      </p>
      <Form method="post" className="mt-8">
        <Button type="submit" size="lg">
          Unsubscribe
        </Button>
      </Form>
      <Footer />
    </main>
  );
}
