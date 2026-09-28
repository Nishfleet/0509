import { env } from "cloudflare:test";
import { env as workerEnv } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jevAnswers = vi.hoisted(() => ({
  noul: new Map<string, number>(),
  choice: new Map<string, string>(),
  calls: 0,
}));

const jevFailures = vi.hoisted(() => ({ next: 0 }));

vi.mock("../../../app/lib/jev/client.server", () => {
  class JevUnavailableError extends Error {
    constructor(cause: unknown) {
      super(`jev unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
      this.name = "JevUnavailableError";
    }
  }
  return {
    JevUnavailableError,
    askNoul: async (workspaceId: string, question: { id: string }) => {
      jevAnswers.calls += 1;
      if (jevFailures.next > 0) {
        jevFailures.next -= 1;
        throw new JevUnavailableError(new Error("gateway down"));
      }
      const p = jevAnswers.noul.get(question.id);
      if (p === undefined) throw new JevUnavailableError(new Error(`no answer for ${question.id}`));
      return { questionId: question.id, inputHash: `noul-${workspaceId}-${question.id}`, p, cached: false };
    },
    askChoice: async (workspaceId: string, question: { id: string }) => {
      jevAnswers.calls += 1;
      const choice = jevAnswers.choice.get(question.id);
      if (choice === undefined) throw new JevUnavailableError(new Error(`no answer for ${question.id}`));
      return { questionId: question.id, inputHash: `choice-${workspaceId}-${question.id}`, choice, cached: false };
    },
  };
});

import type { SiteSweepTarget } from "../../../app/lib/data/watch.server";
import { computeBreakageEvidence } from "../../../app/lib/site/breakage-evidence";
import type { CheckPageResult } from "../../../app/lib/site/check-page.server";
import { diffPageText } from "../../../app/lib/site/diff";
import { judgeChange } from "../../../app/lib/site/judge.server";
import { publishChange } from "../../../app/lib/site/publish.server";
import { checkSitePage, planSiteSweep, type SweepTick } from "../../../app/lib/site/sweep.server";

const USER = "user-own-site-alert";
const WS = "ws-own-site-alert";
const NOW = "2026-09-26T02:00:00Z";
const SELF = "ent-self";
const RIVAL = "ent-rival";

const BEFORE_HTML = `<!doctype html><html><body><h1>MyBrand</h1>
<p>Every plan includes unlimited projects, priority support, single sign-on, audit logs, and a named account manager who answers within one business day, with onboarding help for your whole team and a sandbox to try every feature.</p>
<p>Our dashboard shows who visited, what they read, which trials are close to converting and where the pipeline slowed this week, so a small team can see the whole business without opening five tools or asking an analyst each morning.</p>
<p>Plans start at $29 a month for the starter tier and $99 a month for the growth tier, both billed yearly or monthly, with every seat covered by the same uptime promise and the same thirty-day refund window for every workspace.</p>
</body></html>`;
const BROKEN_HTML = `<!doctype html><html><body><h1>MyBrand</h1><p>Something went wrong.</p></body></html>`;

const holder = { html: "" };

interface BrowserStub {
  calls: string[];
  quickAction(action: "content" | "screenshot", options: { url: string }): Promise<Response>;
}

const browserHolder = vi.hoisted(() => ({ current: undefined as BrowserStub | undefined }));

function installBrowser(): void {
  Object.defineProperty(env, "BROWSER", {
    configurable: true,
    get() {
      return browserHolder.current;
    },
  });
}

function browserStub(): BrowserStub {
  const calls: string[] = [];
  return {
    calls,
    async quickAction(action, options) {
      calls.push(`${action} ${options.url}`);
      if (action === "screenshot") {
        return new Response("png-bytes", { status: 200 });
      }
      return new Response(JSON.stringify({ success: true, result: holder.html, meta: { status: 200 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  };
}

const tick = async (name: string): Promise<SweepTick> => {
  await new Promise((resolve) => setTimeout(resolve, 5));
  return { instanceId: name, plannedAt: new Date().toISOString() };
};

const seedEntity = (id: string, role: "self" | "competitor", domain: string, name: string) =>
  env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, origin, state, created_at)
     VALUES (?, ?, ?, ?, ?, '{}', 'manual', 'on', ?)`,
  )
    .bind(id, WS, role, domain, name, NOW)
    .run();

const readText = async (key: string): Promise<string> => {
  const object = await env.SNAPSHOTS.get(key);
  if (object === null) throw new Error(`missing stored page text ${key}`);
  return object.text();
};

// One pass of the sweep's per-page item: check, diff, code-computed breakage
// evidence, the D3s-then-D3 judgment and the judged publish, exactly the chain
// docs/engines/site-change.md §P4/P6 describes (the issue's `sweepItem`).
const sweepOnePage = async (target: SiteSweepTarget, at: SweepTick): Promise<CheckPageResult> => {
  const checked = await checkSitePage(target, at);
  if (checked.outcome !== "changed") return checked;
  const [beforeText, afterText, subject] = await Promise.all([
    readText(checked.previousTextKey),
    readText(checked.textKey),
    env.DB.prepare("SELECT name, domain FROM entity WHERE id = ?")
      .bind(target.entityId)
      .first<{ name: string | null; domain: string }>(),
  ]);
  if (subject === null) throw new Error(`missing entity ${target.entityId}`);
  const diff = diffPageText(
    { text: beforeText, hash: checked.previousHash, charCount: beforeText.length },
    { text: afterText, hash: checked.hash, charCount: afterText.length },
  );
  if (diff === null) throw new Error("expected a text diff for the changed page");
  const judgment = await judgeChange({
    workspaceId: target.workspaceId,
    entityId: target.entityId,
    isSelf: target.entityRole === "self",
    subject,
    pageUrl: target.url,
    pageRole: target.pageRole,
    hunks: diff.hunks,
    evidence: computeBreakageEvidence({ status: checked.status, beforeText, afterText }),
  });
  if (checked.screenshotKey === null || checked.previousScreenshotKey === null) {
    throw new Error("expected the before-and-after capture pair");
  }
  await publishChange({
    workspaceId: target.workspaceId,
    entityId: target.entityId,
    sourceId: target.sourceId,
    watchId: target.watchId,
    pageId: target.pageId,
    snapshotId: checked.snapshotId,
    url: target.url,
    judgment,
    textKey: checked.textKey,
    previousTextKey: checked.previousTextKey,
    screenshotKey: checked.screenshotKey,
    previousScreenshotKey: checked.previousScreenshotKey,
  });
  return checked;
};

let send: ReturnType<typeof vi.spyOn>;

describe("own-site alert in one sweep pass", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM alert");
    await env.DB.exec("DELETE FROM incident");
    await env.DB.exec("DELETE FROM jev_verdict");
    await env.DB.exec("DELETE FROM signal");
    await env.DB.exec("DELETE FROM snapshot");
    await env.DB.exec("DELETE FROM watch");
    await env.DB.exec("DELETE FROM page");
    await env.DB.exec("DELETE FROM entity");
    await env.DB.exec("DELETE FROM workspace");
    await env.DB.exec('DELETE FROM "user"');
    const listed = await env.SNAPSHOTS.list({ prefix: "snapshot/site/" });
    await Promise.all(listed.objects.map((object) => env.SNAPSHOTS.delete(object.key)));

    await env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, 'Owner', 'own-site-alert@0509.io', 1, ?, ?)`,
    )
      .bind(USER, NOW, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
       VALUES (?, 'Own site alert', ?, 'UTC', 1, 8, ?)`,
    )
      .bind(WS, USER, NOW)
      .run();
    await seedEntity(SELF, "self", "mybrand.com", "MyBrand");
    await seedEntity(RIVAL, "competitor", "rival.com", "Rival");
    await env.DB.exec("UPDATE source SET is_enabled = 1 WHERE id = 'src_site_web'");

    jevAnswers.noul.clear();
    jevAnswers.choice.clear();
    jevAnswers.calls = 0;
    jevFailures.next = 0;
    jevAnswers.noul.set("own_site_breakage", 0.8);
    jevAnswers.noul.set("noteworthy_change", 0.95);
    jevAnswers.choice.set("change_kind", "breakage");

    holder.html = BEFORE_HTML;
    installBrowser();
    browserHolder.current = browserStub();
    send = vi.spyOn(workerEnv.SEND_EMAIL, "send").mockResolvedValue(undefined);
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      return Promise.resolve(
        url.endsWith("/robots.txt")
          ? new Response("User-agent: *\nAllow: /", { status: 200 })
          : new Response(holder.html, { status: 200 }),
      );
    });
  });

  afterEach(() => {
    browserHolder.current = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("a broken own page produces the D3s verdict, an open incident, a pinned alert and one queued email", async () => {
    const self = (await planSiteSweep(NOW)).find((target) => target.entityId === SELF);
    if (self === undefined) throw new Error("expected the self homepage target");

    const baseline = await sweepOnePage(self, await tick("baseline-self"));
    expect(baseline.outcome).toBe("first");

    holder.html = BROKEN_HTML;
    const broken = await sweepOnePage(self, await tick("broken-self"));
    expect(broken.outcome).toBe("changed");

    const verdicts = await env.DB.prepare(
      "SELECT question_id, p, entity_id FROM jev_verdict WHERE workspace_id = ?",
    )
      .bind(WS)
      .all<{ question_id: string; p: number | null; entity_id: string }>();
    expect(verdicts.results).toEqual([{ question_id: "own_site_breakage", p: 0.8, entity_id: SELF }]);

    const incidents = await env.DB.prepare(
      "SELECT id, entity_id, page_id, kind, closed_at FROM incident WHERE workspace_id = ?",
    )
      .bind(WS)
      .all<{ id: string; entity_id: string; page_id: string; kind: string; closed_at: string | null }>();
    expect(incidents.results).toEqual([
      { id: expect.any(String), entity_id: SELF, page_id: self.pageId, kind: "breakage", closed_at: null },
    ]);
    const incident = incidents.results[0];
    if (incident === undefined) throw new Error("expected one open incident");

    const alerts = await env.DB.prepare(
      "SELECT incident_id, kind, severity FROM alert WHERE workspace_id = ?",
    )
      .bind(WS)
      .all<{ incident_id: string | null; kind: string; severity: string }>();
    expect(alerts.results).toEqual([{ incident_id: incident.id, kind: "own_site_broken", severity: "high" }]);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ incident_id: incident.id });
  });

  it("the same break on a competitor opens no incident, no alert and no email", async () => {
    const rival = (await planSiteSweep(NOW)).find((target) => target.entityId === RIVAL);
    if (rival === undefined) throw new Error("expected the rival homepage target");

    const baseline = await sweepOnePage(rival, await tick("baseline-rival"));
    expect(baseline.outcome).toBe("first");

    holder.html = BROKEN_HTML;
    const broken = await sweepOnePage(rival, await tick("broken-rival"));
    expect(broken.outcome).toBe("changed");

    const questions = await env.DB.prepare(
      "SELECT question_id FROM jev_verdict WHERE entity_id = ? ORDER BY question_id",
    )
      .bind(RIVAL)
      .all<{ question_id: string }>();
    expect(questions.results.map((row) => row.question_id)).toEqual(["change_kind", "noteworthy_change"]);

    const incidents = await env.DB.prepare("SELECT COUNT(*) AS n FROM incident WHERE entity_id = ?")
      .bind(RIVAL)
      .first<{ n: number }>();
    expect(incidents?.n).toBe(0);
    const alerts = await env.DB.prepare("SELECT COUNT(*) AS n FROM alert WHERE entity_id = ?")
      .bind(RIVAL)
      .first<{ n: number }>();
    expect(alerts?.n).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});
