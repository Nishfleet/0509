import { WorkflowEntrypoint, type WorkflowStep, type WorkflowEvent } from "cloudflare:workers";

import { confirmEntityStmt, deleteEntityStmt } from "../app/lib/data/entity.server";
import { insertVerdictStmt } from "../app/lib/data/jev-verdict.server";
import { insertSnapshotStmt } from "../app/lib/data/snapshot.server";
import { enabledSources } from "../app/lib/data/source.server";
import { userDecisionStmts } from "../app/lib/data/user-decision.server";
import { insertWatchStmt, siteWatchIdForEntity } from "../app/lib/data/watch.server";
import { readUrl } from "../app/lib/fetch/transport.server";
import { extract } from "../app/lib/identity/extract";
import { jevAsk, jevConfig } from "../app/lib/jev/client";
import { inputHash } from "../app/lib/jev/context-pack";

export interface Params {
  workspaceId: string;
  userId: string;
  entityId: string;
  onboardingRunId: string;
  domain: string;
  homepageUrl: string | null;
  publicSubject: "cleared" | "ask" | "unverified";
}

type GateOutcome =
  | { outcome: "confirmed"; prob?: number | null; reason?: string | null; inputHash?: string }
  | { outcome: "refused"; prob: number | null; reason: string | null; inputHash: string }
  | { outcome: "unreachable"; reason: string };

export class IdentityTailWorkflow extends WorkflowEntrypoint<Env, Params> {
  override async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const p = event.payload;

    const gate: GateOutcome = await step.do("public-subject-gate", async () => {
      try {
        if (p.publicSubject !== "unverified") return { outcome: "confirmed" };
        const jev = jevConfig(this.env);
        if (!jev) return { outcome: "unreachable", reason: "JEV_URL unset" };
        const pack = {
          subject: { input: p.domain, domain: p.domain, homepage_url: p.homepageUrl },
        };
        const res = await jevAsk(jev, pack, {
          public_subject: {
            type: "boolean",
            instructions:
              "Is this input a brand, company or public creator — a public subject we may track — and not a private person?",
          },
        });
        if (!res.ok) return { outcome: "unreachable", reason: res.reason };
        const prob = res.answers.public_subject?.probability ?? null;
        const reason = res.answers.public_subject?.reason ?? null;
        const packHash = await inputHash(pack);
        return prob !== null && prob < 0.1
          ? { outcome: "refused", prob, reason, inputHash: packHash }
          : { outcome: "confirmed", prob, reason, inputHash: packHash };
      } catch (err) {
        return {
          outcome: "unreachable",
          reason: err instanceof Error ? err.message : "gate error",
        };
      }
    });

    if (gate.outcome === "refused") {
      await step.do("persist-refusal", { retries: { limit: 24, delay: "1 hour" } }, async () => {
        const now = new Date().toISOString();
        await this.env.DB.batch([
          insertVerdictStmt(this.env.DB, {
            id: crypto.randomUUID(),
            workspaceId: p.workspaceId,
            questionId: "public_subject",
            inputHash: gate.inputHash,
            entityId: null,
            p: gate.prob,
            choice: null,
            reason: gate.reason,
            now,
          }),
          ...userDecisionStmts(this.env.DB, [
            { workspaceId: p.workspaceId, userId: p.userId, verdict: "refused:public_subject", note: p.domain },
          ]),
          deleteEntityStmt(this.env.DB, { entityId: p.entityId, workspaceId: p.workspaceId }),
        ]);
      });
      return;
    }

    if (gate.outcome === "confirmed") {
      await step.do("persist", { retries: { limit: 24, delay: "1 hour" } }, async () => {
        const now = new Date().toISOString();
        const stmts = [
          confirmEntityStmt(this.env.DB, {
            entityId: p.entityId,
            workspaceId: p.workspaceId,
            now,
          }),
        ];
        if (gate.inputHash) {
          stmts.unshift(
            insertVerdictStmt(this.env.DB, {
              id: crypto.randomUUID(),
              workspaceId: p.workspaceId,
              questionId: "public_subject",
              inputHash: gate.inputHash,
              entityId: null,
              p: gate.prob ?? null,
              choice: null,
              reason: gate.reason ?? null,
              now,
            }),
          );
        }
        await this.env.DB.batch(stmts);
      });
    }

    const watches = await step.do("seed-watches", async () => {
      const sources = await enabledSources(this.env.DB);
      const stmts = sources.map((s) =>
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
      const watchId = await siteWatchIdForEntity(this.env.DB, p.entityId);
      if (watchId) {
        await insertSnapshotStmt(this.env.DB, {
          id: crypto.randomUUID(),
          watchId,
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
