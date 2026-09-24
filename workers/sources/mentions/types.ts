import { z } from "zod";

export const mentionItemSchema = z.object({
	dedupKey: z.string().min(1),
	url: z.url({ protocol: /^https?$/ }),
	title: z.string(),
	publishedAt: z.string().nullable(),
	publisher: z.string().nullable().optional(),
});

export const mentionsResultSchema = z.object({
	items: z.array(mentionItemSchema),
	canaryCount: z.number().int().nonnegative(),
	rawBody: z.string(),
	feedState: z.enum(["ok", "stale", "error"]).optional(),
});

export type MentionsResult = z.infer<typeof mentionsResultSchema>;

export interface MentionsTarget {
	readonly query: string;
}

export type MentionsCursor = string | null;

export type MentionsAdapter = (
	target: MentionsTarget,
	cursor: MentionsCursor,
) => Promise<MentionsResult>;

export function fetchUpstream(url: string): Promise<Response> {
	return fetch(url, { signal: AbortSignal.timeout(8000) });
}
