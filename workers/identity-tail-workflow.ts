// Identity card engine P5 (#3885): the durable tail, started when the user
// taps "That's me". Steps are the durable boundary and the billing unit —
// persist -> seed-watches -> first-snapshot -> start-discovery. A leg that
// ever takes minutes lives here, never in the request path.

import { WorkflowEntrypoint, type WorkflowStep, type WorkflowEvent } from "cloudflare:workers";

import { fetchPage } from "../app/lib/fetch/transport";
import { extract } from "../app/lib/identity/extract";

interface Params {
  workspaceId: string;
  entityId: string;
  onboardingRunId: string;
  domain: string;
  homepageUrl: string | null;
}

export class IdentityTailWorkflow extends WorkflowEntrypoint<Env, Params> {
  override async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const p = event.payload;

    await step.do("persist", async () => {
      const now = new Date().toISOString();
      await this.env.DB.prepare(
        `UPDATE entity SET confirmed_at = ? WHERE id = ? AND workspace_id = ?`,
      )
        .bind(now, p.entityId, p.workspaceId)
        .run();
    });

    const watches = await step.do("seed-watches", async () => {
      // The source registry is global and seeded elsewhere; onboarding reads
      // it, never writes it. Only sources that exist get a watch.
      const sources = await this.env.DB.prepare(
        `SELECT id, kind FROM source WHERE is_enabled = 1`,
      ).all<{ id: string; kind: string }>();
      const stmts = (sources.results ?? []).flatMap((s) => {
        const target =
          s.kind === "site" ? (p.homepageUrl ?? `https://${p.domain}/`) : p.domain;
        return [
          this.env.DB.prepare(
            `INSERT INTO watch (id, entity_id, source_id, target_key, is_active, config_json)
             VALUES (?,?,?,?,1,'{}') ON CONFLICT (entity_id, source_id, target_key) DO NOTHING`,
          ).bind(crypto.randomUUID(), p.entityId, s.id, target),
        ];
      });
      if (stmts.length) await this.env.DB.batch(stmts);
      return stmts.length;
    });

    await step.do("first-snapshot", { retries: { limit: 3, delay: "10 seconds" } }, async () => {
      if (!p.homepageUrl) return { snapshot: false };
      const res = await fetchPage(p.homepageUrl, this.env.BROWSER);
      if (!res.ok) return { snapshot: false, reason: res.reason };
      const extracted = await extract(res.html, p.homepageUrl);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(extracted.text));
      const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      const r2Key = `snapshots/${p.entityId}/${String(Date.now())}.html`;
      await this.env.SNAPSHOTS.put(r2Key, res.html);
      const watchId = await this.env.DB.prepare(
        `SELECT w.id FROM watch w JOIN source s ON s.id = w.source_id
         WHERE w.entity_id = ? AND s.kind = 'site' LIMIT 1`,
      )
        .bind(p.entityId)
        .first<{ id: string }>();
      if (watchId) {
        await this.env.DB.prepare(
          `INSERT INTO snapshot (id, watch_id, fetched_at, payload_r2_key, payload_hash, item_count)
           VALUES (?,?,?,?,?,?)`,
        )
          .bind(crypto.randomUUID(), watchId.id, new Date().toISOString(), r2Key, hash, 0)
          .run();
      }
      return { snapshot: true, r2Key, hash };
    });

    await step.do("start-discovery", async () => {
      // Competitor discovery (#3884) owns the consumer; this enqueue is the
      // contract hand-off so Home is not empty when the user lands.
      await this.env.PAGE_SWEEP.send({
        kind: "discover",
        workspaceId: p.workspaceId,
        entityId: p.entityId,
        domain: p.domain,
        onboardingRunId: p.onboardingRunId,
      });
      await this.env.DB.prepare(
        `UPDATE onboarding_run SET competitors_ready_at = COALESCE(competitors_ready_at, NULL) WHERE id = ?`,
      )
        .bind(p.onboardingRunId)
        .run();
      return watches;
    });
  }
}
