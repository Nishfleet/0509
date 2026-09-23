import { z } from "zod";

const mentionItemSchema = z.object({
  dedupKey: z.string().min(1),
  title: z.string(),
  bodyExcerpt: z.string(),
  canonicalUrl: z.url(),
  publishedAt: z.string().nullable(),
  author: z.string().nullable(),
  publisher: z.string().nullable(),
  engagement: z.record(z.string(), z.number()),
});

export type MentionItem = z.infer<typeof mentionItemSchema>;

export const adapterResultSchema = z.object({
  items: z.array(mentionItemSchema),
  canaryCount: z.number().int().nonnegative(),
  rawBody: z.string(),
  status: z.number().int(),
});

type AdapterResult = z.infer<typeof adapterResultSchema>;

export interface MentionTarget {
  query: string;
  channelId: string | null;
  tag: string | null;
}

export interface MentionAdapter {
  pluginKey: string;
  parse: (body: string) => MentionItem[] | Promise<MentionItem[]>;
  poll: (target: MentionTarget, cursor: string | null) => Promise<AdapterResult>;
}

export class UpstreamStatus extends Error {
  readonly status: number;
  readonly pluginKey: string;

  constructor(pluginKey: string, status: number) {
    super(`${pluginKey} returned ${String(status)}`);
    this.name = "UpstreamStatus";
    this.pluginKey = pluginKey;
    this.status = status;
  }
}

const USER_AGENT = "FiveToNineBot/1.0 (+https://0509.io)";

export async function fetchUpstream(url: string): Promise<{ status: number; body: string }> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: {
      accept: "application/rss+xml, application/atom+xml, application/json, text/html;q=0.5",
      "user-agent": USER_AGENT,
    },
  });
  return { status: response.status, body: await response.text() };
}
