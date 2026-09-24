import type { Route } from "./+types/oauth.authorize";

import { Button } from "../components/ui/button";
import { oauthHelpersContext } from "../lib/agent/context.server";
import { decideConsent, readConsent } from "../lib/agent/consent.server";
import { requireSession } from "../lib/require-session.server";

export function headers() {
  return {
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
  };
}

export function meta() {
  return [{ title: "Connect an app · Five to Nine" }, { name: "robots", content: "noindex" }];
}

function returnTo(request: Request): string {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireSession(request, returnTo(request));
  return readConsent(context.get(oauthHelpersContext), request);
}

export async function action({ request, context }: Route.ActionArgs) {
  const session = await requireSession(request, returnTo(request));
  const form = await request.formData();
  return decideConsent(context.get(oauthHelpersContext), request, {
    userId: session.user.id,
    allow: form.get("decision") === "allow",
  });
}

export default function Page({ loaderData, actionData }: Route.ComponentProps) {
  const view = actionData ?? loaderData;

  if (view.kind === "error") {
    return (
      <main className="mx-auto max-w-lg px-4 py-16">
        <h1 className="font-display text-2xl font-semibold tracking-[-0.02em]">This connection link doesn't work</h1>
        <p className="text-ink-soft mt-4 leading-[1.65]">{view.message}</p>
        <p className="text-ink-soft mt-4 leading-[1.65]">Go back to the app you came from and try connecting again.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <h1 className="font-display text-2xl font-semibold tracking-[-0.02em]">
        Let {view.appName} read your Five to Nine?
      </h1>
      <p className="mt-6 leading-[1.65]">It will be able to see:</p>
      <ul className="mt-2 list-disc pl-6 leading-[1.65]">
        <li>your weekly brief, including where you rank</li>
        <li>the competitors you track and the ones we suggest</li>
        <li>your alerts</li>
      </ul>
      <p className="mt-4 leading-[1.65]">
        It can't change anything, and it only sees your own workspace. You can disconnect it any time in Settings.
      </p>
      <p className="text-ink-soft mt-4 leading-[1.65]">
        After you answer, you go back to <strong className="font-mono text-[0.9rem]">{view.returnsTo}</strong>. If you
        don't recognise that, cancel.
      </p>
      <form method="post" className="mt-8 flex gap-3">
        <Button type="submit" name="decision" value="allow" size="lg">
          Allow
        </Button>
        <Button type="submit" name="decision" value="deny" size="lg" variant="outline">
          Cancel
        </Button>
      </form>
    </main>
  );
}
