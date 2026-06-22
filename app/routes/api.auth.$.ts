import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

async function handleAuth(request: Request, context: LoaderFunctionArgs["context"]) {
  if (isBlockedPublicBetterAuthRoute(request)) {
    return new Response("Use the Five to Nine auth flow.", { status: 404 });
  }

  const { getBetterAuth } = await import("~/lib/better-auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  return getBetterAuth(env, request).handler(request);
}

function isBlockedPublicBetterAuthRoute(request: Request) {
  const pathname = new URL(request.url).pathname;
  return [
    "/api/auth/get-access-token",
    "/api/auth/magic-link/verify",
    "/api/auth/refresh-token",
    "/api/auth/sign-in/magic-link",
    "/api/auth/sign-in/social",
  ].includes(pathname);
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  return handleAuth(request, context);
}

export async function action({ request, context }: ActionFunctionArgs) {
  return handleAuth(request, context);
}
