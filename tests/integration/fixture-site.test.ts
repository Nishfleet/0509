import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import worker from "../../workers/fixture-site";

/**
 * The J8 fixture's whole reason to exist, pinned in a merge gate: the healthy
 * page carries a pricing section with real price tokens, the hard break is a
 * 500, the soft break is a 200 with that section gone, and the flip back to
 * healthy is a real repair (0509#4046; docs/engines/delivery.md P7.5). The soft
 * case is the one D3s actually exercises, so its assertion is on the pricing
 * markup, not on a status code — a 200 that lost its prices is the regression.
 *
 * Real workerd against a real local KV, the same binding kinds production has:
 * a broken gate or a break state that does not survive the round-trip fails
 * here rather than in a live incident run.
 *
 * The flip route mirrors the e2e inbox's token gate (0509#3927), including the
 * 503 when the secret is missing: a fixture that reads healthy because its
 * token was never set is worse than no fixture.
 */
const TOKEN = "integration-token";

const get = () =>
  worker.fetch(new Request("https://fixture.0509.in/"), env, createExecutionContext());

const flip = (mode: string, token: string | null = TOKEN, method = "POST") =>
  worker.fetch(
    new Request(`https://fixture.0509.in/__break?mode=${mode}`, {
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
  // One KV key backs every test, so a flip in one test would leak into the next
  // and make the suite order-dependent. Reset to healthy before each: the
  // healthy-page test only passes reliably because it runs first otherwise, and
  // --sequence.shuffle turns that into a red gate.
  beforeEach(async () => {
    await env.STATE.put("break-mode", "off");
  });

  it("serves the healthy page with its pricing section and price tokens", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<h1>");
    const pricing = readPricing(html);
    expect(pricing).not.toBeNull();
    // Real price tokens, not a placeholder: the D3 verdict that consumes this
    // fixture keys off priced content being present or absent.
    expect(pricing).toContain("₹499");
    expect(pricing).toContain("₹2,499");
    expect(html).toMatch(/href="https:\/\/0509\.io\/checkout\?plan=pro"/);
  });

  it("flips to a hard break and answers 500", async () => {
    const ctx = createExecutionContext();
    await worker.fetch(
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
    expect(await env.STATE.get("break-mode")).toBe("hard");
  });

  it("flips to a soft break and answers 200 with the pricing section absent", async () => {
    const ctx = createExecutionContext();
    await worker.fetch(
      new Request("https://fixture.0509.in/__break?mode=soft", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    const res = await get();
    // The status is the trap, not the proof: the soft case is a 200.
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(readPricing(html)).toBeNull();
    // The headline survives, which is what makes this a content regression the
    // diff sees rather than a dead page.
    expect(html).toContain("<h1>");
  });

  it("repairs back to the healthy page with the pricing section restored", async () => {
    const breakCtx = createExecutionContext();
    await worker.fetch(
      new Request("https://fixture.0509.in/__break?mode=soft", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
      env,
      breakCtx,
    );
    await waitOnExecutionContext(breakCtx);

    const repairCtx = createExecutionContext();
    await worker.fetch(
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
    // Same byte length as `Bearer integration-token` (23): the gate short-circuits
    // on byteLength before timingSafeEqual, so a shorter wrong token never reaches
    // the compare and a stubbed timingSafeEqual would still pass.
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
    const res = await worker.fetch(
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
