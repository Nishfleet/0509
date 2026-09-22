const TTL_SECONDS = 86_400;

function probeKey(domain: string, probe: string): string {
  return `identity:${domain}:${probe}`;
}

async function probeGet<T>(kv: KVNamespace, domain: string, probe: string): Promise<T | null> {
  const raw = await kv.get(probeKey(domain, probe));
  return raw ? (JSON.parse(raw) as T) : null;
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
  cacheable: (v: T) => boolean = () => true,
): Promise<T> {
  if (!kv) return run();
  const hit = await probeGet<T>(kv, domain, probe);
  if (hit !== null) return hit;
  const value = await run();
  if (cacheable(value)) await probePut(kv, domain, probe, value);
  return value;
}
