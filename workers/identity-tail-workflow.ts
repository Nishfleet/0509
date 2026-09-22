import { WorkflowEntrypoint, type WorkflowStep, type WorkflowEvent } from "cloudflare:workers";

import { readUrl } from "../app/lib/fetch/transport.server";
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

    try {
      await step.do("first-snapshot", { retries: { limit: 24, delay: "1 hour" } }, async () => {
        if (!p.homepageUrl) return { snapshot: false };
        const res = await readUrl(p.homepageUrl);
        if (!res.ok) throw new Error(`first-snapshot transport failed: ${res.reason} ${res.detail}`);
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
    } catch {}

    await step.do("start-discovery", async () => {
      await this.env.PAGE_SWEEP.send({
        kind: "discover",
        workspaceId: p.workspaceId,
        entityId: p.entityId,
        domain: p.domain,
        onboardingRunId: p.onboardingRunId,
      });
      return watches;
    });
  }
}
