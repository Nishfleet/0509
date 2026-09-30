import type { Route } from "./+types/u.$token";
import { Form, isRouteErrorResponse } from "react-router";

import { ErrorPage } from "../components/error-page";
import { Footer } from "../components/footer";
import { Button } from "../components/ui/button";
import { isUnsubscribeTokenKnown } from "../lib/data/email_suppression.server";
import { unsubscribe } from "../lib/unsubscribe.server";

const INVALID_LINK = "This link is not valid";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Unsubscribe — Five to Nine" }, { name: "robots", content: "noindex, nofollow" }];
}

export function headers(_: Route.HeadersArgs) {
  return { "Cache-Control": "no-store" };
}

export async function loader({ params }: Route.LoaderArgs) {
  if (!(await isUnsubscribeTokenKnown(params.token))) {
    throw new Response(INVALID_LINK, { status: 404 });
  }
  return { link: "confirm" as const };
}

export async function action({ params }: Route.ActionArgs) {
  if ((await unsubscribe(params.token)) === "invalid_token") {
    throw new Response(INVALID_LINK, { status: 404 });
  }
  return { unsubscribed: true as const };
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  if (!(isRouteErrorResponse(error) && error.status === 404)) {
    return (
      <ErrorPage
        title="The product hit a problem"
        detail="We have been told. Nothing was changed."
        actionHref="/"
        actionLabel="Back to the landing"
      />
    );
  }
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 className="font-display text-2xl font-semibold tracking-[-0.02em]">{INVALID_LINK}</h1>
      <p className="mt-4 leading-[1.65] text-ink-soft">
        The unsubscribe link in that email is expired or mistyped, so nothing was changed. Use the link in the most
        recent brief to stop the weekly email, or email us and we will do it.
      </p>
      <Footer />
    </main>
  );
}

export default function Unsubscribe({ actionData }: Route.ComponentProps) {
  if (actionData?.unsubscribed) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16">
        <h1 className="font-display text-2xl font-semibold tracking-[-0.02em]">You're unsubscribed</h1>
        <p className="mt-4 leading-[1.65] text-ink-soft">No more email will be sent to this address.</p>
        <Footer />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 className="font-display text-2xl font-semibold tracking-[-0.02em]">Stop the weekly brief?</h1>
      <p className="mt-4 leading-[1.65] text-ink-soft">This stops every email from Five to Nine to this address.</p>
      <Form method="post" className="mt-8">
        <Button type="submit" size="lg">
          Unsubscribe
        </Button>
      </Form>
      <Footer />
    </main>
  );
}
