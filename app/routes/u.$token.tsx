import type { Route } from "./+types/u.$token";
import { data, Form } from "react-router";

import { Footer } from "../components/footer";
import { Button } from "../components/ui/button";
import { isUnsubscribeTokenKnown } from "../lib/data/email_suppression.server";
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

export async function loader({ params }: Route.LoaderArgs) {
  if (!(await isUnsubscribeTokenKnown(params.token))) {
    return data({ link: "invalid" as const }, { status: 404 });
  }
  return { link: "confirm" as const };
}

export async function action({ params }: Route.ActionArgs) {
  if ((await unsubscribe(params.token)) === "invalid_token") {
    return data({ link: "invalid" as const, unsubscribed: false }, { status: 404 });
  }
  return { link: "done" as const, unsubscribed: true };
}

function InvalidLink() {
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 className="font-display text-2xl font-semibold tracking-[-0.02em]">This link is not valid</h1>
      <p className="text-ink-soft mt-4 leading-[1.65]">
        The unsubscribe link in that email is expired or mistyped, so nothing was changed. Use the link in
        the most recent brief to stop the weekly email, or email us and we will do it.
      </p>
      <Footer />
    </main>
  );
}

export default function Unsubscribe({ loaderData, actionData }: Route.ComponentProps) {
  if (actionData?.link === "invalid" || (actionData === undefined && loaderData.link === "invalid")) {
    return <InvalidLink />;
  }

  if (actionData !== undefined) {
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
