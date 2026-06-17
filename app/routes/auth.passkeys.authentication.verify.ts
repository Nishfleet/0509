import type { ActionFunctionArgs } from "react-router";

export async function action({ context, request }: ActionFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const { verifyPasskeyAuthentication } = await import("~/lib/passkeys.server");
  const env = getEnv(context);
  const body = await readJson(request);

  try {
    const result = await verifyPasskeyAuthentication(env, request, {
      credential: body.credential as never,
      state: typeof body.state === "string" ? body.state : "",
    });
    return Response.json(
      { ok: true, redirectTo: result.redirectTo },
      { headers: result.headers },
    );
  } catch (error) {
    console.warn("passkey authentication verify failed", safeErrorName(error));
    return Response.json({ error: "passkey_failed" }, { status: 400 });
  }
}

async function readJson(request: Request) {
  return request.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

function safeErrorName(error: unknown) {
  return error instanceof Error ? error.name : "Error";
}
