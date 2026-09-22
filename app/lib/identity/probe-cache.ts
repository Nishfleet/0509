// Identity card engine P1 (#3885): the 24-hour KV probe cache.
// identity:<registrable-domain>:<probe> — read-mostly, tolerant of the 60 s
// propagation window, never same-key hot (REBUILD-STACK.md §4.5). Cache
// failures degrade to a live probe; they never throw into the card path.

const TTL_SECONDS = 86_400;

export function probeKey(domain: string, probe: string): string {
  return `identity:${domain}:${probe}`;
}

export async function probeGet<T>(kv: KVNamespace, domain: string, probe: string): Promise<T | null> {
  try {
    const raw = await kv.get(probeKey(domain, probe));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function probePut(
  kv: KVNamespace,
  domain: string,
  probe: string,
  value: unknown,
): Promise<void> {
  try {
    await kv.put(probeKey(domain, probe), JSON.stringify(value), { expirationTtl: TTL_SECONDS });
  } catch {
    // A cache write that fails loses a re-run optimisation, not the card.
  }
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
