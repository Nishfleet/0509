import { z } from "zod";

export interface HiringSignalState {
  id: string;
  roleId: string;
  lastSeenAt: string | null;
  payloadJson: string;
}

export interface HiringSignalUpdate {
  id: string;
  lastSeenAt: string | null;
  payloadJson: string;
}

export interface Lifecycle {
  state: "open" | "closed";
  missed: 0 | 1;
  closedAt: string | null;
  reopenedAt: string | null;
  reopenCount: number;
}

const lifecycleSchema = z.object({
  state: z.enum(["open", "closed"]),
  missed: z.union([z.literal(0), z.literal(1)]),
  closedAt: z.string().nullable(),
  reopenedAt: z.string().nullable(),
  reopenCount: z.number(),
});

const payloadSchema = z.object({ lifecycle: lifecycleSchema }).loose();

const DEFAULT_LIFECYCLE: Lifecycle = {
  state: "open",
  missed: 0,
  closedAt: null,
  reopenedAt: null,
  reopenCount: 0,
};

function parsePayload(payloadJson: string): unknown {
  try {
    return JSON.parse(payloadJson) as unknown;
  } catch (error) {
    console.error(JSON.stringify({ event: "hiring.role_payload_parse_failed", error: String(error) }));
    return undefined;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readLifecycle(payloadJson: string): Lifecycle {
  const parsed = payloadSchema.safeParse(parsePayload(payloadJson));
  return parsed.success ? parsed.data.lifecycle : DEFAULT_LIFECYCLE;
}

function withLifecycle(payloadJson: string, lifecycle: Lifecycle): string {
  const parsed = parsePayload(payloadJson);
  return JSON.stringify({ ...(isPlainObject(parsed) ? parsed : {}), lifecycle });
}

export function planRoleLifecycle(
  rows: readonly HiringSignalState[],
  presentRoleIds: readonly string[],
  tickAt: string,
): HiringSignalUpdate[] {
  const present = new Set(presentRoleIds);
  const updates: HiringSignalUpdate[] = [];

  for (const row of rows) {
    const lifecycle = readLifecycle(row.payloadJson);
    const isOpen = lifecycle.state === "open";

    if (present.has(row.roleId)) {
      if (isOpen) {
        updates.push({
          id: row.id,
          lastSeenAt: tickAt,
          payloadJson: withLifecycle(row.payloadJson, { ...lifecycle, missed: 0 }),
        });
        continue;
      }
      updates.push({
        id: row.id,
        lastSeenAt: tickAt,
        payloadJson: withLifecycle(row.payloadJson, {
          ...lifecycle,
          state: "open",
          missed: 0,
          reopenedAt: tickAt,
          reopenCount: lifecycle.reopenCount + 1,
        }),
      });
      continue;
    }

    if (!isOpen) continue;

    if (lifecycle.missed === 0) {
      updates.push({
        id: row.id,
        lastSeenAt: row.lastSeenAt,
        payloadJson: withLifecycle(row.payloadJson, { ...lifecycle, missed: 1 }),
      });
      continue;
    }

    updates.push({
      id: row.id,
      lastSeenAt: row.lastSeenAt,
      payloadJson: withLifecycle(row.payloadJson, { ...lifecycle, state: "closed", missed: 0, closedAt: tickAt }),
    });
  }

  return updates;
}
