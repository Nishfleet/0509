import type { Route } from "./+types/login";
import { env } from "cloudflare:workers";
import { Form, useActionData, useNavigation } from "react-router";

import { createAuth } from "../lib/auth.server";

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const submitted = form.get("email");
  const email = typeof submitted === "string" ? submitted.trim().toLowerCase() : "";
  if (!email) return { error: "Enter your email." };

  const auth = createAuth(env);
  // better-auth owns minting, sending and verification. We only hand it the
  // address and report back; a failure here must not reveal whether the
  // address exists.
  // headers are required by the endpoint (requireHeaders: true) — better-auth
  // uses them for origin and rate-limit context, so pass the real ones.
  await auth.api
    .signInMagicLink({ body: { email, callbackURL: "/app" }, headers: request.headers })
    .catch(() => undefined);

  return { sent: true };
}

export default function Login() {
  const data = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";

  if (data && "sent" in data) {
    return (
      <main>
        <h1>Check your email</h1>
        <p>If that address can sign in, a link is on its way. It works once and expires shortly.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Sign in</h1>
      <Form method="post">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
        <button type="submit" disabled={busy}>{busy ? "Sending…" : "Send me a link"}</button>
      </Form>
      {data && "error" in data ? <p role="alert">{data.error}</p> : null}
    </main>
  );
}
