import type { Route } from "./+types/u.$token";
import { Form, isRouteErrorResponse, useNavigation } from "react-router";

import { ErrorPage } from "../components/error-page";
import { Footer, SUPPORT_ADDRESS } from "../components/footer";
import { Button } from "../components/ui/button";
import { isTeammateUnsubscribeToken, isUnsubscribeTokenKnown } from "../lib/data/email_suppression.server";
import { unsubscribe } from "../lib/unsubscribe.server";

const INVALID_LINK = "This unsubscribe link is no longer active";

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
  const teammate = await isTeammateUnsubscribeToken(params.token);
  if ((await unsubscribe(params.token)) === "invalid_token") {
    throw new Response(INVALID_LINK, { status: 404 });
  }
  return { unsubscribed: true as const, teammate };
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
        If you were already unsubscribed, or the person who added you took you off their list, you will not get more
        briefs from it and there is nothing to do. If you are still getting emails, use the link in the most recent one,
        or write to us and we will stop them.
      </p>
      <Footer />
    </main>
  );
}

function ChangedYourMind({ teammate }: { teammate: boolean }) {
  if (teammate) {
    return (
      <p className="mt-4 leading-[1.65] text-ink-soft">
        Changed your mind? Email{" "}
        <a
          className="inline-flex min-h-11 items-center underline underline-offset-4"
          href={`mailto:${SUPPORT_ADDRESS}`}
        >
          {SUPPORT_ADDRESS}
        </a>{" "}
        and we will sort it out.
      </p>
    );
  }
  return (
    <p className="mt-4 leading-[1.65] text-ink-soft">
      Changed your mind? Sign in, open{" "}
      <a className="inline-flex min-h-11 items-center underline underline-offset-4" href="/app/settings">
        Settings
      </a>
      , tick "Send the brief and alerts to this address again" and save.
    </p>
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
          We won't send the weekly brief or alerts to this address any more.
          {actionData.teammate ? "" : " Sign-in links still arrive when you ask for one."}
        </p>
        <ChangedYourMind teammate={actionData.teammate} />
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
