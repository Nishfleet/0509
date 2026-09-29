import {
  createExecutionContext,
  env,
  introspectWorkflowInstance,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env as workerEnv } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readOpenBreakageBaselines } from "../../../app/lib/data/incident.server";
import { nextOwnSiteCheck } from "../../../app/lib/incident-recheck";
import { computeBreakageEvidence } from "../../../app/lib/site/breakage-evidence";
import { checkPage } from "../../../app/lib/site/check-page.server";
import { judgeChange } from "../../../app/lib/site/judge.server";
import { publishChange } from "../../../app/lib/site/publish.server";
import { planSiteSweep } from "../../../app/lib/site/sweep.server";
import { formatDate } from "../../../workers/delivery/brief-template";
import { deliverIncident } from "../../../workers/delivery/consumer";
import fixtureWorker from "../../../workers/fixture-site";

/**
 * 0509#4047's acceptance, verbatim: a real round-trip on the fixture Worker.
 * Break fixture.0509.in soft (a 200 that lost its pricing section), let the
 * paved open path (real snapshot read, code-computed evidence, D3s verdict,
 * publishChange) raise the incident, let the real own-site-check Workflow hold
 * it open while the evidence is still bad, repair the fixture, and watch the
 * Workflow set closed_at and enqueue the one fixed notice.
 *
 * Everything here is real: the fixture Worker module, its Durable Object, the
 * D1 rows, the Workflow engine and the delivery consumer. The only doubles are
 * the Jev seat (its env.AI gateway answers the scripted D3s verdict) and the
 * EMAIL binding, which records instead of hitting Email Service.
 */

const USER = "user-recheck";
const WS = "ws-recheck";
const NOW = "2026-09-28T02:00:00Z";
const SELF = "ent-recheck-self";
const CHANNEL = "chan-email";
const TARGET = "watcher@0509.io";
const TARGET_ID = "target-recheck";
const FIXTURE_ORIGIN = "https://fixture.0509.in";
const FIXTURE_URL = `${FIXTURE_ORIGIN}/`;

type FixtureEnv = Parameters<typeof fixtureWorker.fetch>[1];

const fixtureEnv = () => env as unknown as FixtureEnv;
const fixtureState = () => fixtureEnv().STATE.getByName("fixture");

const fixtureCall = async (path: string, init?: RequestInit): Promise<Response> => {
  const ctx = createExecutionContext();
  const res = await fixtureWorker.fetch(
    new Request(`${FIXTURE_ORIGIN}${path}`, init),
    fixtureEnv(),
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
};

const flip = (mode: "off" | "hard" | "soft") =>
  fixtureCall(`/__break?mode=${mode}`, {
    method: "POST",
    headers: { authorization: `Bearer ${fixtureEnv().FIXTURE_SITE_TOKEN ?? ""}` },
  });

// Every outbound fetch to the fixture host runs the real fixture Worker module
// against the real STATE Durable Object; anything else is a leak and fails loud.
const dispatch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const request = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(request.url);
  if (url.hostname === "fixture.0509.in") {
    return fixtureWorker.fetch(request, fixtureEnv(), createExecutionContext());
  }
  return Promise.reject(new Error(`unexpected fetch to ${url.toString()}`));
};

const jevAnswers = { noul: new Map<string, number>(), choice: new Map<string, string>() };

function installJev(): void {
  Reflect.set(env, "AI", {
    async run(_model: string, request: { questions: Record<string, { type: string }> }) {
      const answers: Record<
        string,
        { type: "noul"; noul: number } | { type: "choice"; choice: string }
      > = {};
      for (const [id, question] of Object.entries(request.questions)) {
        if (question.type === "noul") {
          const p = jevAnswers.noul.get(id);
          if (p === undefined) throw new Error(`no answer for ${id}`);
          answers[id] = { type: "noul", noul: p };
        } else {
          const choice = jevAnswers.choice.get(id);
          if (choice === undefined) throw new Error(`no answer for ${id}`);
          answers[id] = { type: "choice", choice };
        }
      }
      return { answers };
    },
  });
}

interface Recorder {
  sent: EmailMessageBuilder[];
}

const bindingFor = (rec: Recorder): SendEmail => ({
  send(message: EmailMessageBuilder) {
    rec.sent.push(message);
    return Promise.resolve({} as EmailSendResult);
  },
});

const emailEnv = (rec: Recorder): Env => ({ ...env, EMAIL: bindingFor(rec) }) as Env;

const runCheck = async (id: string) => {
  await using introspector = await introspectWorkflowInstance(env.OWN_SITE_CHECK, id);
  await introspector.modify(async (m) => {
    await m.disableSleeps();
  });
  await env.OWN_SITE_CHECK.create({ id });
  await introspector.waitForStatus("complete");
  return introspector.getOutput();
};

interface IncidentRow {
  id: string;
  kind: string;
  opened_at: string;
  closed_at: string | null;
}

interface NoticeRow {
  id: string;
  incident_id: string;
  page_id: string;
  sent_on: string;
  sent_at: string;
  is_resolution: number;
}

const readIncident = () =>
  env.DB.prepare("SELECT id, kind, opened_at, closed_at FROM incident WHERE workspace_id = ?")
    .bind(WS)
    .all<IncidentRow>()
    .then((rows) => rows.results);

const readNotices = (pageId: string) =>
  env.DB.prepare(
    `SELECT id, incident_id, page_id, sent_on, sent_at, is_resolution
       FROM incident_notice WHERE page_id = ? ORDER BY is_resolution ASC`,
  )
    .bind(pageId)
    .all<NoticeRow>()
    .then((rows) => rows.results);

const readAttempt = (key: string) =>
  env.DB.prepare("SELECT id, status, attempted_at FROM send_attempt WHERE idempotency_key = ?")
    .bind(key)
    .first<{ id: string; status: string; attempted_at: string }>();

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

let send: ReturnType<typeof vi.spyOn>;

describe("own-site incident re-check round-trip on the fixture Worker (0509#4047)", () => {
  beforeEach(async () => {
    for (const table of [
      "send_attempt",
      "incident_notice",
      "alert",
      "incident",
      "jev_verdict",
      "signal",
      "snapshot",
      "watch",
      "send_target",
      "channel",
      "page",
      "entity",
      "email_suppression",
      "digest",
      "workspace",
      '"user"',
    ]) {
      await env.DB.exec(`DELETE FROM ${table}`);
    }
    const stored = await env.SNAPSHOTS.list({ prefix: "snapshot/site/" });
    await Promise.all(stored.objects.map((object) => env.SNAPSHOTS.delete(object.key)));
    await fixtureState().put("break-mode", "off");
    await fixtureState().put("bot-wall", "off");
    await fixtureState().put("price-variant", "base");
    await fixtureState().delete("price-flipped-at");

    await env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, 'Watcher', ?, 1, ?, ?)`,
    )
      .bind(USER, TARGET, NOW, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
       VALUES (?, 'Recheck', ?, 'UTC', 1, 8, ?)`,
    )
      .bind(WS, USER, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO channel (id, key, is_enabled, config_json) VALUES (?, 'email', 1, '{}')`,
    )
      .bind(CHANNEL)
      .run();
    await env.DB.prepare(
      `INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at)
       VALUES (?, ?, ?, ?, 1, ?)`,
    )
      .bind(TARGET_ID, WS, CHANNEL, TARGET, NOW)
      .run();
    // The entered host shares the entity's registrable domain, so the paved
    // planner itself points the watch at the fixture Worker (0509#5834 shape).
    await env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, origin, state, created_at)
       VALUES (?, ?, 'self', '0509.in', 'Five to Nine', ?, 'manual', 'on', ?)`,
    )
      .bind(SELF, WS, '{"kind":"domain","url":"https://fixture.0509.in/"}', NOW)
      .run();
    await env.DB.exec("UPDATE source SET is_enabled = 1 WHERE id = 'src_site_web'");

    jevAnswers.noul.clear();
    jevAnswers.choice.clear();
    jevAnswers.noul.set("own_site_breakage", 0.8);
    installJev();
    send = vi.spyOn(workerEnv.SEND_EMAIL, "send").mockResolvedValue(undefined);
    vi.stubGlobal("fetch", dispatch);
  });

  afterEach(async () => {
    await fixtureState().put("break-mode", "off");
    await fixtureState().put("bot-wall", "off");
    Reflect.deleteProperty(env, "AI");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("breaks soft, holds the incident across two ticks without resending, then closes it with exactly one fixed notice", async () => {
    // The paved planner creates the home page row and watch for the fixture URL.
    const targets = await planSiteSweep(NOW);
    const self = targets.find((target) => target.entityId === SELF);
    if (self === undefined) throw new Error("expected the fixture self target");
    expect(self.url).toBe(FIXTURE_URL);
    expect(self.entityRole).toBe("self");

    // Healthy baseline through the real transport and the real fixture Worker.
    const baseline = await checkPage({
      watchId: self.watchId,
      pageId: self.pageId,
      url: self.url,
    });
    if (baseline.outcome !== "first") throw new Error("expected the baseline capture");
    // The before capture pair is what the incident's alert links as evidence.
    const baselinePngKey = baseline.textKey.replace(/\.txt$/, ".png");
    await env.SNAPSHOTS.put(baselinePngKey, "png-bytes");

    // Soft break, set through the fixture's real token-gated route: a 200 page
    // whose pricing section is gone.
    expect((await flip("soft")).status).toBe(200);
    const softRead = await fixtureWorker.fetch(
      new Request(FIXTURE_URL),
      fixtureEnv(),
      createExecutionContext(),
    );
    expect(softRead.status).toBe(200);
    const softHtml = await softRead.text();
    expect(softHtml).not.toContain('<section id="pricing"');

    const changed = await checkPage({
      watchId: self.watchId,
      pageId: self.pageId,
      url: self.url,
      read: {
        ok: true,
        html: softHtml,
        transport: "fetch",
        status: 200,
        ms: 0,
        escalated: false,
      },
    });
    if (changed.outcome !== "changed") throw new Error("expected the soft break to change the page");
    if (changed.previousScreenshotKey === null) {
      throw new Error("expected the baseline screenshot key to resolve");
    }

    // The paved open leg: code-computed evidence plus the D3s verdict, then
    // publishChange writes the incident, the pinned alert and the queue item.
    const [beforeText, afterText, subject] = await Promise.all([
      env.SNAPSHOTS.get(changed.previousTextKey).then((o) => o?.text() ?? ""),
      env.SNAPSHOTS.get(changed.textKey).then((o) => o?.text() ?? ""),
      env.DB.prepare("SELECT name, domain FROM entity WHERE id = ?")
        .bind(SELF)
        .first<{ name: string | null; domain: string }>(),
    ]);
    if (subject === null) throw new Error("missing entity");
    const judgment = await judgeChange({
      workspaceId: self.workspaceId,
      entityId: self.entityId,
      signalId: null,
      isSelf: true,
      subject,
      pageUrl: self.url,
      pageRole: self.pageRole,
      hunks: [],
      evidence: computeBreakageEvidence({ status: changed.status, beforeText, afterText }),
    });
    expect(judgment.selfBreakage).toEqual({ p: 0.8, band: "alert" });

    const published = await publishChange({
      workspaceId: self.workspaceId,
      entityId: self.entityId,
      sourceId: self.sourceId,
      watchId: self.watchId,
      pageId: self.pageId,
      snapshotId: changed.snapshotId,
      url: self.url,
      judgment,
      textKey: changed.textKey,
      previousTextKey: changed.previousTextKey,
      screenshotKey: changed.screenshotKey,
      previousScreenshotKey: changed.previousScreenshotKey,
    });
    if (published.incidentId === null) throw new Error("expected the breakage incident to open");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ incident_id: published.incidentId });

    const [incident] = await readIncident();
    if (incident === undefined) throw new Error("expected one open incident");
    expect(incident).toMatchObject({ kind: "breakage", closed_at: null });
    expect(incident.opened_at).toMatch(ISO_UTC);
    expect(incident.id).toBe(published.incidentId);

    // The open notice's re-check time is the Workflow's real next tick, read
    // from the signal payload publishChange wrote — never the word "soon".
    const signal = await env.DB.prepare(
      `SELECT s.payload_json FROM signal s
       JOIN alert a ON a.signal_id = s.id WHERE a.incident_id = ?`,
    )
      .bind(incident.id)
      .first<{ payload_json: string }>();
    if (signal === null) throw new Error("expected the incident's signal");
    const payload = JSON.parse(signal.payload_json) as { seenAt: string; recheckAt: string };
    expect(payload.seenAt).toMatch(ISO_UTC);
    // The promised re-check is the Workflow's own next hourly tick, derived in
    // code — not prose, and never "soon".
    expect(payload.recheckAt).toBe(nextOwnSiteCheck(new Date(incident.opened_at)));

    // The baseline the close lane resolves is the one the paved opener stored
    // as previousTextKey (the shape COALESCE now reads on either dialect).
    const baselines = await readOpenBreakageBaselines();
    expect(baselines[self.pageId]).toBe(changed.previousTextKey);

    // Deliver the open notice for real through the consumer's recorder binding.
    const rec: Recorder = { sent: [] };
    const openDelivery = await deliverIncident(emailEnv(rec), { incident_id: incident.id });
    expect(openDelivery.outcome).toBe("sent");
    expect(openDelivery.idempotency_key).toBe(`incident:${incident.id}:open`);
    expect(rec.sent).toHaveLength(1);
    expect(rec.sent[0].subject).toBe("fixture.0509.in looks broken: breakage");
    const promised = formatDate(payload.recheckAt, "UTC", true);
    expect(rec.sent[0].text).toContain(`We re-check at ${promised} and email you once when it is fixed.`);
    expect(rec.sent[0].text).not.toContain("soon");

    const [openNotice] = await readNotices(self.pageId);
    if (openNotice === undefined) throw new Error("expected the open incident_notice row");
    expect(openNotice).toMatchObject({ incident_id: incident.id, is_resolution: 0 });
    expect(openNotice.sent_at).toMatch(ISO_UTC);
    expect(await readAttempt(`incident:${incident.id}:open`)).toMatchObject({ status: "sent" });

    // Two own-site ticks with the fixture still soft-broken: the open incident
    // is re-checked first, the code-computed evidence still says broken, so it
    // neither closes nor re-sends.
    expect(await runCheck("recheck-tick-1")).toEqual({ pages: 1, opened: 0, closed: 0, failed: 0 });
    expect((await readIncident())[0]?.closed_at).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
    expect(await runCheck("recheck-tick-2")).toEqual({ pages: 1, opened: 0, closed: 0, failed: 0 });
    expect((await readIncident())[0]?.closed_at).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
    const openRedelivery = await deliverIncident(emailEnv(rec), { incident_id: incident.id });
    expect(openRedelivery.outcome).toBe("duplicate");
    expect(rec.sent).toHaveLength(1);
    expect(await readNotices(self.pageId)).toHaveLength(1);

    // Repair through the real fixture route, then the hourly tick re-checks,
    // finds the evidence clear and closes the incident itself.
    expect((await flip("off")).status).toBe(200);
    expect(await runCheck("recheck-fixed")).toEqual({ pages: 1, opened: 0, closed: 1, failed: 0 });
    const [closed] = await readIncident();
    if (closed?.closed_at == null) throw new Error("expected closed_at to be set");
    expect(closed.closed_at).toMatch(ISO_UTC);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith({ incident_id: incident.id });

    const fixedDelivery = await deliverIncident(emailEnv(rec), { incident_id: incident.id });
    expect(fixedDelivery.outcome).toBe("sent");
    expect(fixedDelivery.idempotency_key).toBe(`incident:${incident.id}:fixed`);
    expect(rec.sent).toHaveLength(2);
    expect(rec.sent[1].subject).toBe("fixture.0509.in looks fixed: breakage");
    expect(rec.sent[1].text).toContain("We re-checked fixture.0509.in at");
    expect(rec.sent[1].text).toContain("looks fixed");

    // Exactly one resolution notice; a replayed queue message is a duplicate.
    const fixedRedelivery = await deliverIncident(emailEnv(rec), { incident_id: incident.id });
    expect(fixedRedelivery.outcome).toBe("duplicate");
    expect(rec.sent).toHaveLength(2);

    const notices = await readNotices(self.pageId);
    expect(notices).toHaveLength(2);
    expect(notices.map((row) => row.is_resolution)).toEqual([0, 1]);
    expect(await readAttempt(`incident:${incident.id}:fixed`)).toMatchObject({ status: "sent" });

    // The acceptance citations, printed for the PR body.
    console.log(
      JSON.stringify({
        incident_id: incident.id,
        opened_at: incident.opened_at,
        closed_at: closed.closed_at,
        incident_notice_ids: notices.map((row) => row.id),
        recheck_at: payload.recheckAt,
      }),
    );
  });
});
