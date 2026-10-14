import type { Route } from "./+types/u.$token";
import { isRouteErrorResponse, useNavigation } from "react-router";

import { z } from "zod";

import { ErrorPage } from "../components/error-page";
import { Footer } from "../components/footer";
import { UnsubscribeConfirm, UnsubscribeDone } from "../components/unsubscribe-page";
import { isTeammateUnsubscribeToken, isUnsubscribeTokenKnown } from "../lib/data/email_suppression.server";
import { unsubscribe, unsubscribeScope } from "../lib/unsubscribe.server";

const INVALID_LINK = "This unsubscribe link is no longer active";

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

export async function action({ params, request }: Route.ActionArgs) {
  const teammate = await isTeammateUnsubscribeToken(params.token);
  const form = await request.formData().catch(() => new FormData());
  const widened = widenForm.safeParse(Object.fromEntries(form));
  const scope = widened.success && widened.data.scope === "all" ? "all" : linkScope(request);
  if ((await unsubscribe(params.token, scope)) === "invalid_token") {
    throw new Response(INVALID_LINK, { status: 404 });
  }
  return { unsubscribed: true as const, scope, teammate };
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

export default function Unsubscribe({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  if (actionData?.unsubscribed) {
    return <UnsubscribeDone scope={actionData.scope} teammate={actionData.teammate} busy={busy} />;
  }
  return <UnsubscribeConfirm scope={loaderData.scope} busy={busy} />;
}
