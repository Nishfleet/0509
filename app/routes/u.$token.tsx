import type { Route } from "./+types/u.$token";

import { suppressToken } from "../lib/email-suppression.server";

function responseFor(result: "suppressed" | "missing"): Response {
  if (result === "missing") {
    return new Response("This link does not match an address.", { status: 404 });
  }
  return new Response("This address will not receive email from 0509.", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export async function loader({ params }: Route.LoaderArgs) {
  return responseFor(await suppressToken(params.token));
}

export async function action({ params }: Route.ActionArgs) {
  const result = await suppressToken(params.token);
  if (result === "missing") return responseFor(result);
  return new Response(null, { status: 200 });
}
