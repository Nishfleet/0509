import type { ActionFunctionArgs } from "react-router";

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { verifyPasskeyRegistration } = await import("~/lib/passkeys.server");
  const env = getEnv(context);
  const body = await readJson(request);

  try {
    const session = await requireSession(env, request);
    await verifyPasskeyRegistration(env, request, session, {
      credential: body.credential as never,
      state: typeof body.state === "string" ? body.state : "",
    });
    return Response.json({ ok: true });
  } catch (error) {
    console.warn("passkey registration verify failed", safeErrorName(error));
    return Response.json({ error: "passkey_failed" }, { status: 400 });
  }
}

async function readJson(request: Request) {
  return request.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

function safeErrorName(error: unknown) {
  return error instanceof Error ? error.name : "Error";
}
