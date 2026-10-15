import { env } from "cloudflare:workers";

export function identityTailInstanceId(entityId: string): string {
  return `identity-tail-${entityId}`;
}

export async function terminateIdentityTail(entityId: string): Promise<void> {
  try {
    const instance = await env.IDENTITY_TAIL.get(identityTailInstanceId(entityId));
    await instance.terminate();
  } catch (error) {
    if (error instanceof Error && error.message.includes("instance.not_found")) return;
    console.error(JSON.stringify({ event: "identity_tail.terminate_failed", entityId, message: String(error) }));
  }
}
