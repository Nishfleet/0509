import { z } from "zod";

import { fetchOutbound } from "../../../app/lib/fetch/outbound.server";
import { CRAWLER_USER_AGENT } from "../../../app/lib/fetch/robots.server";

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

export type MentionsAdapter = (target: MentionsTarget, cursor: MentionsCursor) => Promise<MentionsResult>;

export const BLOCKING_STATUSES: ReadonlySet<number> = new Set([202, 403, 429]);

export const SOURCE_SETTINGS = {
  "gdelt.doc": {
    timeoutMs: 24_000,
    timeoutRetries: 1,
    retryBackoffMs: 1_000,
    rateLimitRetries: 2,
    rateLimitPauseMs: 8_000,
  },
} as const;

export class UpstreamBlockedError extends Error {
  constructor(readonly status: number) {
    super(`upstream blocked: HTTP ${String(status)}`);
    this.name = "UpstreamBlockedError";
  }
}

export function isUpstreamTimeout(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name: unknown }).name === "TimeoutError";
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface UpstreamRetry {
  retries?: number;
  backoffMs?: number;
  rateLimitRetries?: number;
  rateLimitPauseMs?: number;
}

type RetryKind = "timeouts" | "limited";

function retryKind(error: unknown, used: Record<RetryKind, number>, options: UpstreamRetry): RetryKind | null {
  if (isUpstreamTimeout(error)) return used.timeouts < (options.retries ?? 0) ? "timeouts" : null;
  const rateLimited = error instanceof UpstreamBlockedError && error.status === 429;
  return rateLimited && used.limited < (options.rateLimitRetries ?? 0) ? "limited" : null;
}

export async function fetchUpstream(url: string, timeoutMs = 8000, options: UpstreamRetry = {}): Promise<Response> {
  let used: Record<RetryKind, number> = { timeouts: 0, limited: 0 };
  for (;;) {
    try {
      const response = await fetchOutbound(url, {
        headers: { "user-agent": CRAWLER_USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (BLOCKING_STATUSES.has(response.status)) throw new UpstreamBlockedError(response.status);
      return response;
    } catch (error) {
      const kind = retryKind(error, used, options);
      if (kind === null) throw error;
      used = { ...used, [kind]: used[kind] + 1 };
      const pauseMs =
        kind === "timeouts" ? options.backoffMs : (options.rateLimitPauseMs ?? 0) * 2 ** (used.limited - 1);
      await pause(pauseMs ?? 0);
    }
  }
}
