import { z } from "zod";

export const mentionItemSchema = z.object({
  dedupKey: z.string().min(1),
  url: z.url({ protocol: /^https?$/ }),
  title: z.string().min(1),
  publisher: z.string().nullable(),
  publishedAt: z.string().nullable(),
});

export type MentionItem = z.infer<typeof mentionItemSchema>;

export function webItems(items: readonly unknown[]): MentionItem[] {
  return items.flatMap((item) => {
    const parsed = mentionItemSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

interface MentionsResult {
  items: MentionItem[];
  rawBody: string;
}

export type MentionsAdapter = (target: { readonly query: string }) => Promise<MentionsResult>;

export function fetchUpstream(url: string): Promise<Response> {
  return fetch(url, {
    headers: { "User-Agent": "0509.io/1.0 (https://0509.io)" },
    signal: AbortSignal.timeout(8000),
  });
}
