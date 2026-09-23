import type { z } from "zod";

const TTL_SECONDS = 86_400;

function probeKey(domain: string, probe: string): string {
  return `identity:${domain}:${probe}`;
}

async function probeGet<T>(
  kv: KVNamespace,
  domain: string,
  probe: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const key = probeKey(domain, probe);
  const raw = await kv.get(key);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(
      JSON.stringify({ event: "probe-cache-corrupt", key, error: err instanceof Error ? err.message : "parse failed" }),
    );
    await kv.delete(key);
    return null;
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    console.error(JSON.stringify({ event: "probe-cache-shape-mismatch", key, issues: result.error.issues.length }));
    await kv.delete(key);
    return null;
  }
  return result.data;
}

async function probePut(
  kv: KVNamespace,
  domain: string,
  probe: string,
  value: unknown,
): Promise<void> {
  await kv.put(probeKey(domain, probe), JSON.stringify(value), { expirationTtl: TTL_SECONDS });
}

export async function probeThrough<T>(
  kv: KVNamespace | undefined,
  domain: string,
  probe: string,
  run: () => Promise<T>,
  schema: z.ZodType<T>,
  cacheable: (v: T) => boolean = () => true,
): Promise<T> {
  if (!kv) return run();
  const hit = await probeGet(kv, domain, probe, schema);
  if (hit !== null) return hit;
  const value = await run();
  if (cacheable(value)) await probePut(kv, domain, probe, value);
  return value;
}
