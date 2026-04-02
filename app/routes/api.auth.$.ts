import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

async function handleAuth(request: Request, context: LoaderFunctionArgs["context"]) {
  const { createAuth } = await import("~/lib/auth.server");
  const env = (context.cloudflare as { env: Env }).env;
  return createAuth(env, request).handler(request);
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  return handleAuth(request, context);
}

export async function action({ request, context }: ActionFunctionArgs) {
  return handleAuth(request, context);
}
