import type { ActionFunctionArgs } from "react-router";

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { createPasskeyRegistrationOptions } = await import("~/lib/passkeys.server");
  const env = getEnv(context);

  try {
    const session = await requireSession(env, request);
    const result = await createPasskeyRegistrationOptions(env, request, session);
    return Response.json(result);
  } catch (error) {
    console.warn("passkey registration options failed", safeErrorName(error));
    return Response.json({ error: "passkey_unavailable" }, { status: 400 });
  }
}

function safeErrorName(error: unknown) {
  return error instanceof Error ? error.name : "Error";
}
