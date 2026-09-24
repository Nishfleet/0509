import type { Route } from "./+types/app.settings";

import { Link, Outlet, redirect } from "react-router";
import { env } from "cloudflare:workers";

import { DeleteAccount, SignOut } from "../components/account-settings";
import { deleteAccount } from "../lib/account-delete.server";
import { oauthHelpersContext } from "../lib/agent/context.server";
import { signOut } from "../lib/auth.server";
import { requireSession } from "../lib/require-session.server";

const MISMATCH = "That doesn't match your email. Type it exactly to delete your account.";
const SIGN_IN_AGAIN = "For your safety, sign out and sign back in, then delete your account.";

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireSession(request);
  return { email: session.user.email };
}

export async function action({ request, context }: Route.ActionArgs) {
  const session = await requireSession(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "sign-out") {
    throw redirect("/login", { headers: await signOut(env, request) });
  }
  if (intent === "delete-account") {
    const confirm = form.get("confirm");
    const typed = typeof confirm === "string" ? confirm.trim().toLowerCase() : "";
    if (typed !== session.user.email.toLowerCase()) return { deleteError: MISMATCH };
    const headers = await deleteAccount(context.get(oauthHelpersContext), request, session.user.id);
    if (headers === null) return { deleteError: SIGN_IN_AGAIN };
    throw redirect("/login", { headers });
  }
  return { deleteError: null };
}

export default function Page({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <main>
      <h1>Settings</h1>
      <p>Signed in as {loaderData.email}</p>
      <p>
        <Link to="/app/settings/agents" prefetch="intent">Agents and API</Link>
      </p>
      <Outlet />
      <SignOut />
      <DeleteAccount email={loaderData.email} error={actionData?.deleteError ?? null} />
    </main>
  );
}
