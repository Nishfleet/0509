import { WorkflowEntrypoint, type WorkflowStep, type WorkflowEvent } from "cloudflare:workers";

import { confirmEntityStmt } from "../app/lib/data/entity.server";
import { insertSnapshotStmt } from "../app/lib/data/snapshot.server";
import { insertWatchStmt } from "../app/lib/data/watch.server";
import { readUrl } from "../app/lib/fetch/transport.server";
import { extract } from "../app/lib/identity/extract";
import { inputHash } from "../app/lib/jev/context-pack";

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
      await confirmEntityStmt(this.env.DB, {
        entityId: p.entityId,
        workspaceId: p.workspaceId,
        now: new Date().toISOString(),
      }).run();
    });

    const watches = await step.do("seed-watches", async () => {
      const sources = await this.env.DB.prepare(
        `SELECT id, kind FROM source WHERE is_enabled = 1`,
      ).all<{ id: string; kind: string }>();
      const stmts = (sources.results ?? []).map((s) =>
        insertWatchStmt(this.env.DB, {
          id: crypto.randomUUID(),
          entityId: p.entityId,
          sourceId: s.id,
          target: s.kind === "site" ? (p.homepageUrl ?? `https://${p.domain}/`) : p.domain,
        }),
      );
      if (stmts.length) await this.env.DB.batch(stmts);
      return stmts.length;
    });

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

    await step.do("first-snapshot", { retries: { limit: 24, delay: "1 hour" } }, async () => {
      if (!p.homepageUrl) return { snapshot: false };
      const res = await readUrl(p.homepageUrl);
      if (!res.ok) throw new Error(`first-snapshot transport failed: ${res.reason} ${res.detail}`);
      const extracted = await extract(res.html, p.homepageUrl);
      const hash = await inputHash(extracted.text);
      const r2Key = `snapshots/${p.entityId}/${String(Date.now())}.html`;
      await this.env.SNAPSHOTS.put(r2Key, res.html);
      const watchId = await this.env.DB.prepare(
        `SELECT w.id FROM watch w JOIN source s ON s.id = w.source_id
         WHERE w.entity_id = ? AND s.kind = 'site' LIMIT 1`,
      )
        .bind(p.entityId)
        .first<{ id: string }>();
      if (watchId) {
        await insertSnapshotStmt(this.env.DB, {
          id: crypto.randomUUID(),
          watchId: watchId.id,
          fetchedAt: new Date().toISOString(),
          r2Key,
          hash,
          itemCount: 0,
        }).run();
      }
      return { snapshot: true, r2Key, hash };
    });
  }
}
