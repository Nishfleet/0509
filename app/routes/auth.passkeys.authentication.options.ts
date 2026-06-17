import type { ActionFunctionArgs } from "react-router";

export async function action({ context, request }: ActionFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const { createPasskeyAuthenticationOptions } = await import("~/lib/passkeys.server");
  const env = getEnv(context);
  const body = await readJson(request);

  try {
    const result = await createPasskeyAuthenticationOptions(env, request, {
      redirectTo: typeof body.redirectTo === "string" ? body.redirectTo : null,
    });
    return Response.json(result);
  } catch (error) {
    console.warn("passkey authentication options failed", safeErrorName(error));
    return Response.json({ error: "passkey_unavailable" }, { status: 400 });
  }
}

async function readJson(request: Request) {
  return request.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

function safeErrorName(error: unknown) {
  return error instanceof Error ? error.name : "Error";
}
