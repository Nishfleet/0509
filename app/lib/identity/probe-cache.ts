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
  const raw = await kv.get(probeKey(domain, probe));
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = schema.safeParse(parsed);
  return result.success ? result.data : null;
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
