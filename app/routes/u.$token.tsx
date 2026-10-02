import type { Route } from "./+types/u.$token";
import { Form, isRouteErrorResponse, useNavigation } from "react-router";

import { ErrorPage } from "../components/error-page";
import { Footer } from "../components/footer";
import { Button } from "../components/ui/button";
import { isUnsubscribeTokenKnown } from "../lib/data/email_suppression.server";
import { unsubscribe } from "../lib/unsubscribe.server";

const INVALID_LINK = "This link is not valid";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Unsubscribe · Five to Nine" }, { name: "robots", content: "noindex, nofollow" }];
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
        title="Something went wrong"
        detail="This is a problem on our side and we have been alerted. Nothing was changed. Please try again in a minute."
        actionHref="/"
        actionLabel="Back to home"
      />
    );
  }
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 className="font-display text-2xl font-semibold tracking-[-0.02em]">{INVALID_LINK}</h1>
      <p className="mt-4 leading-[1.65] text-ink-soft">
        This unsubscribe link has expired or is incorrect, so nothing was changed. Use the link in your most recent
        weekly brief, or email us and we will do it for you.
      </p>
      <Footer />
    </main>
  );
}

export default function Unsubscribe({ actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const unsubscribing = navigation.state !== "idle";
  if (actionData?.unsubscribed) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16">
        <h1 className="font-display text-2xl font-semibold tracking-[-0.02em]">You're unsubscribed</h1>
        <p className="mt-4 leading-[1.65] text-ink-soft">
          We won't send the weekly brief or alerts to this address any more. Sign-in links still arrive when you ask for
          one.
        </p>
        <p className="mt-4 leading-[1.65] text-ink-soft">
          Changed your mind? Sign in, open{" "}
          <a className="inline-flex min-h-11 items-center underline underline-offset-4" href="/app/settings">
            Settings
          </a>
          , tick "Send the brief to this address again" and save.
        </p>
        <Footer />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 className="font-display text-2xl font-semibold tracking-[-0.02em]">Unsubscribe from Five to Nine emails?</h1>
      <p className="mt-4 leading-[1.65] text-ink-soft">
        You will stop getting the weekly brief and all alerts from Five to Nine at this address. Sign-in links still
        arrive when you ask for one.
      </p>
      <Form method="post" className="mt-8">
        <Button type="submit" size="lg" disabled={unsubscribing}>
          {unsubscribing ? "Unsubscribing…" : "Unsubscribe"}
        </Button>
      </Form>
      <Footer />
    </main>
  );
}
