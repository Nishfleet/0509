import { env, introspectWorkflow } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AiSpendOffError, refuseWhenFixtureWorkspace } from "../../app/lib/ai/spend.server";
import { startCard } from "../../app/lib/identity/card.server";
import { normaliseSubject } from "../../app/lib/identity/normalise";
import {
  askChoice,
  askMixed,
  askNoul,
  askNouls,
  JevSpendOffError,
  probeJev,
  type ChoiceQuestion,
  type NoulQuestion,
} from "../../app/lib/jev/client.server";
import {
  takeBrowserEscalation,
  takeBrowserScreenshot,
  takeBrowserShareImage,
} from "../../app/lib/site/browser-budget.server";

const NOW = "2026-10-21T00:00:00.000Z";
const FIXTURE = "ws-fence-fixture";
const NORMAL = "ws-fence-normal";
const DAY = "2026-10-21";

const NOUL: NoulQuestion = { id: "fence_noul", instructions: "i", whenTrue: "t", whenFalse: "f" };
const CHOICE: ChoiceQuestion = { id: "fence_choice", instructions: "i", options: { a: "A", b: "B" } };

const BOT_GATED_HTML = `<!doctype html><html><head><title>Botgated</title>
<meta property="og:description" content="A description that only the browser could read"></head>
<body><h1>Botgated</h1></body></html>`;

function answered(questions: Record<string, "noul" | "choice">) {
  return {
    answers: Object.fromEntries(
      Object.entries(questions).map(([id, type]) => [
        id,
        type === "noul" ? { type, noul: 0.5 } : { type, choice: "a" },
      ]),
    ),
  };
}

function installAi(response: unknown) {
  const run = vi.fn((_model: string, _request: unknown, _options?: unknown) => Promise.resolve(response));
  Reflect.set(env, "AI", { run });
  return run;
}

function installBrowser() {
  const calls: string[] = [];
  const quickAction = (_action: string, options: { url: string }) => {
    calls.push(options.url);
    return Promise.resolve(
      new Response(JSON.stringify({ success: true, result: BOT_GATED_HTML, meta: { status: 200 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  Object.defineProperty(env, "BROWSER", { configurable: true, value: { quickAction } });
  return calls;
}

async function seedWorkspace(id: string, fixture: boolean): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, 'Owner', ?2, 0, ?3, ?3)`,
  )
    .bind(`user-${id}`, `${id}@0509.io`, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, created_at, fixture) VALUES (?1, 'Owner', ?2, ?3, ?4)`,
  )
    .bind(id, `user-${id}`, NOW, fixture ? 1 : 0)
    .run();
}

beforeEach(async () => {
  await seedWorkspace(FIXTURE, true);
  await seedWorkspace(NORMAL, false);
  vi.stubGlobal("fetch", () => Promise.resolve(new Response("blocked", { status: 403 })));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(env, "AI");
  Reflect.deleteProperty(env, "BROWSER");
  await env.DB.prepare(`DELETE FROM "user" WHERE id IN ('user-${FIXTURE}', 'user-${NORMAL}')`).run();
});

describe("Workers AI for a fixture workspace", () => {
  it.each([
    ["askNoul", (id: string) => askNoul(id, NOUL, { s: id })],
    ["askNouls", (id: string) => askNouls(id, [NOUL], { s: id })],
    ["askChoice", (id: string) => askChoice(id, CHOICE, { s: id })],
    ["askMixed", (id: string) => askMixed(id, { noul: NOUL, choice: CHOICE }, { s: id })],
  ])("%s refuses like AI_SPEND=off and never calls the model", async (_name, ask) => {
    const run = installAi(answered({ [NOUL.id]: "noul", [CHOICE.id]: "choice" }));

    const failure: unknown = await ask(FIXTURE).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(JevSpendOffError);
    expect(failure).toHaveProperty("message", expect.stringContaining("fixture workspace"));
    expect(run).not.toHaveBeenCalled();
  });

  it("still asks the model for a normal workspace", async () => {
    const noulRun = installAi(answered({ [NOUL.id]: "noul" }));
    await askNoul(NORMAL, NOUL, { s: "normal" });
    const choiceRun = installAi(answered({ [CHOICE.id]: "choice" }));
    await askChoice(NORMAL, CHOICE, { s: "normal" });

    expect(noulRun).toHaveBeenCalledTimes(1);
    expect(choiceRun).toHaveBeenCalledTimes(1);
  });

  it("is refused with an AiSpendOffError so every caller that handles AI_SPEND=off handles it", async () => {
    await expect(refuseWhenFixtureWorkspace(FIXTURE)).rejects.toBeInstanceOf(AiSpendOffError);
    await expect(refuseWhenFixtureWorkspace(NORMAL)).resolves.toBeUndefined();
  });

  it("stops the Jev probe that opens a Discovery run", async () => {
    const run = installAi(answered({ jev_probe: "noul" }));

    await expect(probeJev(FIXTURE)).rejects.toBeInstanceOf(JevSpendOffError);
    expect(run).not.toHaveBeenCalled();
    await expect(probeJev(NORMAL)).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("ends a Discovery run for a fixture workspace before any model call", async () => {
    const run = installAi(answered({ jev_probe: "noul" }));
    await env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, state, domain, created_at) VALUES ('ent-fence-self', ?1, 'self', 'on', 'fence-self.example', ?2)`,
    )
      .bind(FIXTURE, NOW)
      .run();
    await using introspector = await introspectWorkflow(env.DISCOVERY);

    await env.DISCOVERY.create({ id: "discovery-fence", params: { workspaceId: FIXTURE, mode: "create" } });
    const [instance] = await introspector.get();
    if (instance === undefined) throw new Error("discovery instance was not started");
    await instance.waitForStatus("errored");

    expect(run).not.toHaveBeenCalled();
  });
});

describe("Browser Rendering for a fixture workspace", () => {
  it("refuses every browser budget draw", async () => {
    expect(await takeBrowserEscalation(FIXTURE, "ent-fence", DAY)).toBe(false);
    expect(await takeBrowserScreenshot(FIXTURE, "ent-fence", DAY)).toBe(false);
    expect(await takeBrowserShareImage(FIXTURE, DAY)).toBe(false);
  });

  it("still grants a normal workspace its draws", async () => {
    expect(await takeBrowserEscalation(NORMAL, "ent-fence", DAY)).toBe(true);
    expect(await takeBrowserScreenshot(NORMAL, "ent-fence", DAY)).toBe(true);
    expect(await takeBrowserShareImage(NORMAL, DAY)).toBe(true);
  });

  it("never opens a browser session to read a bot-gated site for a fixture workspace", async () => {
    installAi(answered({}));
    const calls = installBrowser();
    const normalised = normaliseSubject("fence-fixture-gated.com");
    if (!normalised.ok) throw new Error("must normalise");

    const card = startCard(FIXTURE, normalised.subject, []);
    await card.settled;

    expect(calls).toEqual([]);
  });

  it("opens one browser session to read the same site for a normal workspace", async () => {
    installAi(answered({}));
    const calls = installBrowser();
    const normalised = normaliseSubject("fence-normal-gated.com");
    if (!normalised.ok) throw new Error("must normalise");

    const card = startCard(NORMAL, normalised.subject, []);
    await card.settled;

    expect(calls).toEqual(["https://fence-normal-gated.com/"]);
  });
});
