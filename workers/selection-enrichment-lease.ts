import { DurableObject } from "cloudflare:workers";

/**
 * Issue #3782: the search-selection enrichment lease as a Durable Object.
 *
 * The old `enrichmentInFlightStartedAt` Map only held inside one isolate, so a
 * revalidation routed to a second isolate could schedule a duplicate Browser
 * Rendering capture for the same ad. One DO instance per metaAdId
 * (`idFromName(metaAdId)`): the lease is a single `lockedUntil` timestamp in
 * object storage, claimed inside a storage transaction, so two isolates can
 * never both win and the lease survives object eviction.
 *
 * Extends the `cloudflare:workers` DurableObject base so the generated
 * `worker-configuration.d.ts` binding type is RPC-branded; the node unit
 * test mocks that module with a stub base class.
 */
export class SelectionEnrichmentLease extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/acquire") {
      const body = (await request.json().catch(() => ({}))) as {
        ttlMs?: unknown;
      };
      const ttlMs =
        typeof body.ttlMs === "number" && Number.isFinite(body.ttlMs)
          ? Math.min(Math.max(body.ttlMs, 0), 10 * 60 * 1000)
          : 90_000;
      const now = Date.now();
      const claimed = await this.ctx.storage.transaction(async () => {
        const lockedUntil =
          (await this.ctx.storage.get<number>("lockedUntil")) ?? 0;
        if (lockedUntil > now) {
          return false;
        }
        await this.ctx.storage.put("lockedUntil", now + ttlMs);
        return true;
      });
      return Response.json({ claimed });
    }
    if (request.method === "POST" && url.pathname === "/release") {
      await this.ctx.storage.delete("lockedUntil");
      return Response.json({ released: true });
    }
    return new Response("Not Found", { status: 404 });
  }
}
