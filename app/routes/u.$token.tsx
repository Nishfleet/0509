import type { Route } from "./+types/u.$token";
import { isRouteErrorResponse, useNavigation } from "react-router";

import { z } from "zod";

import { ErrorPage } from "../components/error-page";
<<<<<<< HEAD
import { Footer, SUPPORT_ADDRESS } from "../components/footer";
import { Button } from "../components/ui/button";
import { isTeammateUnsubscribeToken, isUnsubscribeTokenKnown } from "../lib/data/email_suppression.server";
import { unsubscribe } from "../lib/unsubscribe.server";
=======
import { Footer } from "../components/footer";
import { UnsubscribeConfirm, UnsubscribeDone } from "../components/unsubscribe-page";
import { isUnsubscribeTokenKnown } from "../lib/data/email_suppression.server";
import { unsubscribe, unsubscribeScope } from "../lib/unsubscribe.server";
>>>>>>> 73f4c440c (Let people stop the brief or alerts on their own)

const INVALID_LINK = "This link is not valid";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Unsubscribe · Five to Nine" }, { name: "robots", content: "noindex, nofollow" }];
}

export function headers(_: Route.HeadersArgs) {
  return { "Cache-Control": "no-store" };
}

const widenForm = z.object({ scope: z.literal("all").optional() });

function linkScope(request: Request) {
  return unsubscribeScope(new URL(request.url).searchParams.get("type"));
}

export async function loader({ params, request }: Route.LoaderArgs) {
  if (!(await isUnsubscribeTokenKnown(params.token))) {
    throw new Response(INVALID_LINK, { status: 404 });
  }
  return { link: "confirm" as const, scope: linkScope(request) };
}

<<<<<<< HEAD
export async function action({ params }: Route.ActionArgs) {
  const teammate = await isTeammateUnsubscribeToken(params.token);
  if ((await unsubscribe(params.token)) === "invalid_token") {
    throw new Response(INVALID_LINK, { status: 404 });
  }
  return { unsubscribed: true as const, teammate };
=======
export async function action({ params, request }: Route.ActionArgs) {
  const form = await request.formData();
  const widened = widenForm.safeParse(Object.fromEntries(form));
  const scope = widened.success && widened.data.scope === "all" ? "all" : linkScope(request);
  if ((await unsubscribe(params.token, scope)) === "invalid_token") {
    throw new Response(INVALID_LINK, { status: 404 });
  }
  return { unsubscribed: true as const, scope };
>>>>>>> 73f4c440c (Let people stop the brief or alerts on their own)
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

<<<<<<< HEAD
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
=======
export default function Unsubscribe({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  if (actionData?.unsubscribed) return <UnsubscribeDone scope={actionData.scope} busy={busy} />;
  return <UnsubscribeConfirm scope={loaderData.scope} busy={busy} />;
>>>>>>> 73f4c440c (Let people stop the brief or alerts on their own)
}
