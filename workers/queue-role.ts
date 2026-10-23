export type QueueRole = "send-email" | "send-email-dlq" | "fetch-sweep" | "fetch-sweep-dlq";

const ROLES: ReadonlySet<string> = new Set<QueueRole>([
  "send-email",
  "send-email-dlq",
  "fetch-sweep",
  "fetch-sweep-dlq",
]);

const STAGING_SUFFIX = "-staging";

export class UnknownQueueError extends Error {
  constructor(queue: string) {
    super(`no consumer is wired for the queue "${queue}"`);
    this.name = "UnknownQueueError";
  }
}

function isQueueRole(name: string): name is QueueRole {
  return ROLES.has(name);
}

export function queueRole(queue: string): QueueRole {
  const base = queue.endsWith(STAGING_SUFFIX) ? queue.slice(0, -STAGING_SUFFIX.length) : queue;
  if (isQueueRole(base)) return base;
  throw new UnknownQueueError(queue);
}

export async function routeQueueBatch<Batch extends { queue: string }>(
  batch: Batch,
  handlers: Record<QueueRole, (batch: Batch) => Promise<unknown>>,
): Promise<void> {
  await handlers[queueRole(batch.queue)](batch);
}
