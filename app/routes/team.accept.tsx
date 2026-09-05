import { Form, Link, redirect, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { SubmitButton } from "~/components/submit-button";

export const meta = () => [{ title: "Join team | Five to Nine" }];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { getOptionalSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { peekWorkspaceInvite } = await import("~/lib/workspace.server");
  const env = getEnv(context);
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";

  if (!token) {
    return { valid: false as const, reason: "This invite link is incomplete.", token: "" };
  }

  const invite = await peekWorkspaceInvite(env, token);
  if (!invite) {
    return {
      valid: false as const,
      reason: "This invite link is no longer valid — ask for a fresh one.",
      token: "",
    };
  }

  const session = await getOptionalSession(env, request);
  if (!session) {
    const next = new URL("/auth/signup", request.url);
    next.searchParams.set("email", invite.invitedEmail);
    next.searchParams.set("redirectTo", `/team/accept?token=${token}`);
    throw redirect(`${next.pathname}${next.search}`);
  }

  return {
    valid: true as const,
    reason: null,
    token,
    ownerName: invite.ownerName,
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { acceptWorkspaceInvite } = await import("~/lib/workspace.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const formData = await request.formData();
  const token = String(formData.get("token") ?? "");

  const result = await acceptWorkspaceInvite(env, {
    token,
    userId: session.user.id,
    userEmail: session.user.email,
  });

  if (!result.ok) {
    return { ok: false as const, reason: result.reason };
  }

  throw redirect("/app");
}

export default function TeamAcceptRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <main className="f9-error-page">
      <div className="f9-container f9-error-layout">
        <div className="f9-error-card">
          {!data.valid ? (
            <>
              <h1>Invite not available</h1>
              <p>{data.reason}</p>
              <Link className="f9-wk-btn" to="/app">
                Go to your account
              </Link>
            </>
          ) : (
            <>
              <h1>Join {data.ownerName ? `${data.ownerName}'s` : "this"} team?</h1>
              <p>
                You&rsquo;ll share their watchlists, collections, and morning digests. Your sign-in
                stays your own, and the account owner handles billing.
              </p>
							{actionData && !actionData.ok ? (
								<div className="f9-wk-notice is-error" role="alert">
									<p>{actionData.reason}</p>
								</div>
							) : null}
              <Form method="post">
                <input type="hidden" name="token" value={data.token} />
								<SubmitButton className="f9-wk-btn" pendingLabel="Joining…">
									Join the team
								</SubmitButton>
              </Form>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
