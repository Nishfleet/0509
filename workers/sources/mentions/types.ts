import { z } from "zod";

export const mentionItemSchema = z.object({
	dedupKey: z.string().min(1),
	url: z.string().url(),
	title: z.string(),
	publishedAt: z.string().nullable(),
});

export const mentionsResultSchema = z.object({
	items: z.array(mentionItemSchema),
	canaryCount: z.number().int().nonnegative(),
	rawBody: z.string(),
});

export type MentionsResult = z.infer<typeof mentionsResultSchema>;

export type MentionsTarget = { readonly query: string };

export type MentionsCursor = string | null;

export type MentionsAdapter = (
	target: MentionsTarget,
	cursor: MentionsCursor,
) => Promise<MentionsResult>;

export function fetchUpstream(url: string): Promise<Response> {
	return fetch(url, { signal: AbortSignal.timeout(8000) });
}
