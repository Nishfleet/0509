import { redirect } from "react-router";
import type { ActionFunctionArgs } from "react-router";

async function logout({ context, request }: ActionFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const { deleteStytchSessionByToken } = await import("~/lib/data.server");
  const {
    clearStytchSessionCookie,
    isSameOriginAuthFormPost,
    readStytchSessionToken,
    revokeStytchSession,
  } = await import("~/lib/stytch-b2b.server");
  const env = getEnv(context);
  if (!isSameOriginAuthFormPost(env, request)) {
    throw new Response("Invalid logout request.", { status: 403 });
  }

  const sessionToken = readStytchSessionToken(request);
  if (sessionToken) {
    await deleteStytchSessionByToken(env, sessionToken).catch((error) => {
      console.warn("local Stytch session delete failed", error);
    });
    await revokeStytchSession(env, sessionToken).catch((error) => {
      console.warn("stytch session revoke failed", error);
    });
  }

  throw redirect("/", {
    headers: {
      "Set-Cookie": clearStytchSessionCookie(request),
    },
  });
}

export async function loader() {
  throw redirect("/");
}

export async function action(args: ActionFunctionArgs) {
  return logout(args);
}
