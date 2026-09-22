import { z } from "zod";

const brand = z.object({
  name: z.string().nullable(),
  domain: z.string(),
  state: z.string(),
  identity: z.record(z.string(), z.unknown()),
});

export const d4PackSchema = z.object({
  self: brand,
  subject: brand,
  competitor_set: z.array(z.object({ name: z.string().nullable(), domain: z.string() })),
  item: z.object({
    signal_id: z.string(),
    kind: z.string(),
    title: z.string().nullable(),
    summary: z.string().nullable(),
    url: z.string().nullable(),
    evidence_url: z.string().nullable(),
    observed_at: z.string(),
    source_key: z.string(),
  }),
  history_30d: z.array(z.object({
    kind: z.string(),
    title: z.string().nullable(),
    observed_at: z.string(),
  })),
  user_memory: z.array(z.object({
    verdict: z.string(),
    note: z.string().nullable(),
    decided_at: z.string(),
  })),
});

export type D4Pack = z.infer<typeof d4PackSchema>;

const IMPORTANCE_CRITERIA = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"] as const;

export function d4RequestBody(pack: D4Pack): {
  model: "jev-latest";
  state: D4Pack;
  questions: {
    read_this_first: { type: "noul"; instructions: string };
    importance: { type: "score"; instructions: string; criteria: readonly string[] };
  };
} {
  return {
    model: "jev-latest",
    state: pack,
    questions: {
      read_this_first: {
        type: "noul",
        instructions: "Does this noteworthy item belong in self's read-this-first for the week?",
      },
      importance: {
        type: "score",
        instructions: "How important is this item for self this week, from 0 to 10?",
        criteria: IMPORTANCE_CRITERIA,
      },
    },
  };
}

export async function hashPack(pack: D4Pack): Promise<string> {
  const encoded = new TextEncoder().encode(stableStringify(pack));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
