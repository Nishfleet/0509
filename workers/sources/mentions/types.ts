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

export type MentionItem = z.infer<typeof mentionItemSchema>;

export interface MentionsTarget {
	readonly query: string;
}

export type MentionsCursor = string | null;

export type MentionsAdapter = (
	target: MentionsTarget,
	cursor: MentionsCursor,
) => Promise<MentionsResult>;

export const BLOCKING_STATUSES: ReadonlySet<number> = new Set([202, 403, 429]);

export class UpstreamBlockedError extends Error {
	constructor(readonly status: number) {
		super(`upstream blocked: HTTP ${String(status)}`);
		this.name = "UpstreamBlockedError";
	}
}

export async function fetchUpstream(url: string): Promise<Response> {
	const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
	if (BLOCKING_STATUSES.has(response.status)) throw new UpstreamBlockedError(response.status);
	return response;
}
