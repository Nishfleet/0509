import { createExecutionContext, env as workerdEnv, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { computeBreakageEvidence } from "../../app/lib/site/breakage-evidence";
import { extractPageText } from "../../app/lib/site/extract-text";
import worker from "../../workers/fixture-site";
import { FIXTURE_HEALTHY_TEXT, FIXTURE_SOFT_TEXT } from "../fixtures/fixture-page-texts";

const TOKEN = "integration-token";

type FixtureEnv = Parameters<typeof worker.fetch>[1];

const env = workerdEnv as unknown as FixtureEnv;

const callFetch = worker.fetch as (request: Request, env: FixtureEnv, ctx: ExecutionContext) => Promise<Response>;

const state = () => env.STATE.getByName("fixture.0509.in");

const get = () => callFetch(new Request("https://fixture.0509.in/"), env, createExecutionContext());

const flip = (mode: string, token: string | null = TOKEN, method = "POST") =>
  callFetch(
    new Request(`https://fixture.0509.in/__break?mode=${mode}`, {
      method,
      headers: token === null ? {} : { authorization: `Bearer ${token}` },
    }),
    env,
    createExecutionContext(),
  );

const setPrice = (variant: string, token: string | null = TOKEN, method = "POST") =>
  callFetch(
    new Request(`https://fixture.0509.in/__price?variant=${variant}`, {
      method,
      headers: token === null ? {} : { authorization: `Bearer ${token}` },
    }),
    env,
    createExecutionContext(),
  );

const setWall = (state: string, token: string | null = TOKEN, method = "POST") =>
  callFetch(
    new Request(`https://fixture.0509.in/__wall?state=${state}`, {
      method,
      headers: token === null ? {} : { authorization: `Bearer ${token}` },
    }),
    env,
    createExecutionContext(),
  );

const readPricing = (html: string) => {
  const section = /<section id="pricing"[\s\S]*?<\/section>/.exec(html);
  return section?.[0] ?? null;
};

describe("0509-fixture-site", () => {
  beforeEach(async () => {
    await state().put("break-mode", "off");
    await state().put("bot-wall", "off");
    await state().put("price-variant", "base");
    await state().delete("price-flipped-at");
  });

  it("serves the healthy page with its pricing section and price tokens", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<h1>");
    const pricing = readPricing(html);
    expect(pricing).not.toBeNull();

    expect(pricing).toContain("₹499");
    expect(pricing).toContain("₹2,499");
    expect(html).toMatch(/href="https:\/\/0509\.io\/checkout\?plan=pro"/);
    expect((await extractPageText(html)).text).toBe(FIXTURE_HEALTHY_TEXT);
  });

  it("flips to a hard break and answers 500", async () => {
    const ctx = createExecutionContext();
    await callFetch(
      new Request("https://fixture.0509.in/__break?mode=hard", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    const res = await get();
    expect(res.status).toBe(500);
    expect(await state().get("break-mode")).toBe("hard");
  });

  it("serves the hard break to the very next fetch, read from the Durable Object", async () => {
    await flip("hard");
    const res = await get();
    expect(res.status).toBe(500);
    expect(await state().get("break-mode")).toBe("hard");
  });

  it("flips to a soft break: a 200 whose visible content is all gone, the shape D3s must call broken", async () => {
    const ctx = createExecutionContext();
    await callFetch(
      new Request("https://fixture.0509.in/__break?mode=soft", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    const res = await get();

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(readPricing(html)).toBeNull();

    expect(html).not.toContain("<h1>");
    expect(html).toContain('data-mode="soft"');
    const broken = await extractPageText(html);
    expect(broken.text).toBe(FIXTURE_SOFT_TEXT);

    expect(
      computeBreakageEvidence({ status: 200, beforeText: FIXTURE_HEALTHY_TEXT, afterText: broken.text }),
    ).toMatchObject({ httpError: false, textHalved: true, pricesVanished: true });
  });

  it("repairs back to the healthy page with the pricing section restored", async () => {
    const breakCtx = createExecutionContext();
    await callFetch(
      new Request("https://fixture.0509.in/__break?mode=soft", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
      env,
      breakCtx,
    );
    await waitOnExecutionContext(breakCtx);

    const repairCtx = createExecutionContext();
    await callFetch(
      new Request("https://fixture.0509.in/__break?mode=off", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
      env,
      repairCtx,
    );
    await waitOnExecutionContext(repairCtx);

    const res = await get();
    expect(res.status).toBe(200);
    expect(readPricing(await res.text())).not.toBeNull();
  });

  it("403s on a wrong token of the same length, so the constant-time compare is really exercised", async () => {
    expect((await flip("hard", "integration-tokeX")).status).toBe(403);
  });

  it("403s on no Authorization header", async () => {
    expect((await flip("hard", null)).status).toBe(403);
  });

  it("405s a GET on the flip route, so no prefetch can break the fixture", async () => {
    expect((await flip("hard", TOKEN, "GET")).status).toBe(405);
  });

  it("400s on an unknown mode", async () => {
    expect((await flip("sideways")).status).toBe(400);
  });

  it("503s naming the secret when FIXTURE_SITE_TOKEN is unset on the Worker", async () => {
    const res = await callFetch(
      new Request("https://fixture.0509.in/__break?mode=hard", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
      { ...env, FIXTURE_SITE_TOKEN: undefined },
      createExecutionContext(),
    );
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("FIXTURE_SITE_TOKEN");
  });
});

describe("price variant", () => {
  beforeEach(async () => {
    await state().put("break-mode", "off");
    await state().put("price-variant", "base");
    await state().delete("price-flipped-at");
    await state().put("bot-wall", "off");
  });

  it("serves a fresh page on the base price with no flip time", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-variant="base"');
    expect(html).toContain('data-flipped-at=""');
    expect(html).toContain("₹1,299");
  });

  it("flips to raised and back to base, stamping the flip time on the page", async () => {
    const raiseCtx = createExecutionContext();
    const res = await callFetch(
      new Request("https://fixture.0509.in/__price?variant=raised", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
      env,
      raiseCtx,
    );
    await waitOnExecutionContext(raiseCtx);
    expect(res.status).toBe(200);
    const html = await (await get()).text();
    expect(html).toContain('data-variant="raised"');
    expect(html).toContain("₹1,499");
    expect(html).not.toContain("₹1,299");
    const at = /data-flipped-at="([^"]*)"/.exec(html)?.[1];
    expect(Number.isFinite(Date.parse(at ?? ""))).toBe(true);

    const baseCtx = createExecutionContext();
    const back = await callFetch(
      new Request("https://fixture.0509.in/__price?variant=base", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
      env,
      baseCtx,
    );
    await waitOnExecutionContext(baseCtx);
    expect(back.status).toBe(200);
    const restored = await (await get()).text();
    expect(restored).toContain('data-variant="base"');
    expect(restored).toContain("₹1,299");
    expect(restored).not.toContain("₹1,499");
  });

  it("403s with no token, 405s a GET, and 400s an unknown variant", async () => {
    expect((await setPrice("raised", null)).status).toBe(403);
    expect((await setPrice("raised", TOKEN, "GET")).status).toBe(405);
    expect((await setPrice("cheap")).status).toBe(400);
  });

  it("keeps data-variant on a soft break, when the pricing section is gone", async () => {
    const priceCtx = createExecutionContext();
    await callFetch(
      new Request("https://fixture.0509.in/__price?variant=raised", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
      env,
      priceCtx,
    );
    await waitOnExecutionContext(priceCtx);

    const breakCtx = createExecutionContext();
    await callFetch(
      new Request("https://fixture.0509.in/__break?mode=soft", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
      env,
      breakCtx,
    );
    await waitOnExecutionContext(breakCtx);

    const html = await (await get()).text();
    expect(readPricing(html)).toBeNull();
    expect(html).toContain('data-variant="raised"');
  });
});

describe("bot wall", () => {
  beforeEach(async () => {
    await state().put("break-mode", "off");
    await state().put("bot-wall", "off");
  });

  it("403s on a wall flip with no token", async () => {
    const res = await setWall("on", null);
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("forbidden");
  });

  it("405s a GET on the wall route, so no prefetch can wall the site", async () => {
    expect((await setWall("on", TOKEN, "GET")).status).toBe(405);
  });

  it("400s on an unknown wall state", async () => {
    expect((await setWall("maybe")).status).toBe(400);
  });

  it("walls the page with a 403 Cloudflare-style challenge, then unwalls it", async () => {
    expect((await setWall("on")).status).toBe(200);
    const walled = await get();
    expect(walled.status).toBe(403);
    expect(await walled.text()).toContain("Just a moment...");

    expect((await setWall("off")).status).toBe(200);
    const unwalled = await get();
    expect(unwalled.status).toBe(200);
    expect(readPricing(await unwalled.text())).not.toBeNull();
  });

  it("leaves the break mode alone while the wall turns on and off", async () => {
    await flip("soft");
    await setWall("on");
    await setWall("off");
    const html = await (await get()).text();

    expect(readPricing(html)).toBeNull();
    expect(await state().get("break-mode")).toBe("soft");
    expect(await state().get("bot-wall")).toBe("off");
    await flip("off");
    expect(readPricing(await (await get()).text())).not.toBeNull();
  });
});

describe("per-hostname state", () => {
  const J8 = "j8.fixture.0509.in";

  const onJ8 = (path: string, method = "GET") =>
    callFetch(
      new Request(`https://${J8}${path}`, {
        method,
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
      env,
      createExecutionContext(),
    );

  beforeEach(async () => {
    await state().put("break-mode", "off");
    await state().put("bot-wall", "off");
    await state().put("price-variant", "base");
    await env.STATE.getByName(J8).put("break-mode", "off");
    await env.STATE.getByName(J8).put("price-variant", "base");
  });

  it("keeps a hard break on j8.fixture.0509.in off fixture.0509.in", async () => {
    expect((await onJ8("/__break?mode=hard", "POST")).status).toBe(200);
    expect((await onJ8("/")).status).toBe(500);
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('data-mode="off"');
  });

  it("keeps a price flip on fixture.0509.in off j8.fixture.0509.in", async () => {
    expect((await setPrice("raised")).status).toBe(200);
    const html = await (await onJ8("/")).text();
    expect(html).toContain('data-variant="base"');
  });
});
