import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { buildLinkedInOAuthAuthorizeUrl } from "~/lib/presence-connectors/linkedin.server";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const url = new URL(request.url);
  const entityId = url.searchParams.get("entity") ?? "";
  const state = `${session.user.id}:${entityId}:${crypto.randomUUID()}`;
  const authorizeUrl = buildLinkedInOAuthAuthorizeUrl(env, state);
  if (!authorizeUrl) {
    return new Response("LinkedIn OAuth is not configured.", { status: 503 });
  }
  return redirect(authorizeUrl);
}
