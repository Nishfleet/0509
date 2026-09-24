import { env } from "cloudflare:workers";
import { z } from "zod";

const MESSAGE = z.object({
  kind: z.literal("discovery-meta-adlib"),
  workspaceId: z.string().min(1),
  enqueuedAt: z.string().min(20),
});

export interface MetaAdlibMessage {
  kind: "discovery-meta-adlib";
  workspaceId: string;
  enqueuedAt: string;
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "page-sweep.unreadable",
        message: error instanceof Error ? error.message : "unreadable",
      }),
    );
    return null;
  }
}

export function parseMetaAdlibMessage(body: unknown): MetaAdlibMessage | null {
  const value = typeof body === "string" ? parseJson(body) : body;
  const parsed = MESSAGE.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function enqueueMetaAdlib(
  workspaceId: string,
  now: Date = new Date(),
  send: (message: MetaAdlibMessage) => Promise<void> = async (message) => {
    await env.PAGE_SWEEP.send(message);
  },
): Promise<string> {
  const enqueuedAt = now.toISOString();
  await send({ kind: "discovery-meta-adlib", workspaceId, enqueuedAt });
  return enqueuedAt;
}
