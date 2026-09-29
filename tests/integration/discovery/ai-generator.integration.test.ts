import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { aiGenerator } from "../../../app/lib/discovery/generators/ai.server";
import type { FetchedText, Subject } from "../../../app/lib/discovery/types";

const SUBJECT: Subject = { name: "Gymshark", domain: "gymshark.com", description: "Fitness apparel" };

const HOME =
  '<html><head><title> Gymshark | Gymwear </title><meta name="description" content="Fitness apparel and accessories"></head></html>';

function home(body = HOME): (url: string) => Promise<FetchedText> {
  return (url) => Promise.resolve({ ok: true, status: 200, url, contentType: "text/html", body });
}

function proposes(response: unknown): ReturnType<typeof vi.fn> {
  const run = vi.fn().mockResolvedValue({ response });
  Reflect.set(env, "AI", { run });
  return run;
}

function liveHosts(...hosts: string[]): void {
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const host = new URL(input instanceof Request ? input.url : String(input)).hostname;
    return hosts.includes(host) ? Promise.resolve(new Response(null, { status: 200 })) : Promise.reject(new TypeError("dns"));
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(env, "AI");
});

describe("aiGenerator", () => {
  it("turns a valid list into evidence-tagged candidates and sends the homepage text through the gateway", async () => {
    const run = proposes({ competitors: [{ name: "Alphalete", domain: "alphaleteathletics.com" }, { name: "Ryderwear", domain: "https://www.ryderwear.com/shop" }] });
    liveHosts("alphaleteathletics.com", "ryderwear.com");
    const candidates = await aiGenerator(SUBJECT, home());
    expect(candidates.map((candidate) => [candidate.name, candidate.domain])).toEqual([
      ["Alphalete", "alphaleteathletics.com"],
      ["Ryderwear", "ryderwear.com"],
    ]);
    expect(candidates[0]?.evidence).toEqual([expect.objectContaining({ generator: "ai", sourceUrl: "https://gymshark.com/" })]);
    const [model, input, options] = run.mock.calls[0] as [string, { messages: { content: string }[]; response_format: { type: string } }, unknown];
    expect(model).toBe("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
    expect(input.response_format.type).toBe("json_schema");
    expect(input.messages[1]?.content).toContain("Gymshark | Gymwear");
    expect(input.messages[1]?.content).toContain("Fitness apparel and accessories");
    expect(options).toEqual({ gateway: { id: "default" } });
  });

  it("drops a hallucinated domain that does not resolve", async () => {
    proposes({ competitors: [{ name: "Real Co", domain: "realco.com" }, { name: "Ghost", domain: "ghost-brand-xyz.com" }] });
    liveHosts("realco.com");
    const candidates = await aiGenerator(SUBJECT, home());
    expect(candidates.map((candidate) => candidate.name)).toEqual(["Real Co"]);
  });

  it("drops the subject's own domain and duplicate proposals", async () => {
    proposes({ competitors: [{ name: "Gymshark", domain: "www.gymshark.com" }, { name: "A", domain: "a.com" }, { name: "A again", domain: "a.com" }] });
    liveHosts("www.gymshark.com", "a.com");
    const candidates = await aiGenerator(SUBJECT, home());
    expect(candidates.map((candidate) => candidate.domain)).toEqual(["a.com"]);
  });

  it("degrades to zero candidates when the AI binding throws", async () => {
    Reflect.set(env, "AI", { run: vi.fn().mockRejectedValue(new Error("gateway down")) });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(aiGenerator(SUBJECT, home())).resolves.toEqual([]);
  });

  it("degrades to zero candidates on malformed JSON", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    proposes("{not json");
    await expect(aiGenerator(SUBJECT, home())).resolves.toEqual([]);
    proposes({ competitors: "nope" });
    await expect(aiGenerator(SUBJECT, home())).resolves.toEqual([]);
  });

  it("still proposes from the card when the homepage cannot be fetched", async () => {
    const run = proposes(JSON.stringify({ competitors: [{ name: "A", domain: "a.com" }] }));
    liveHosts("a.com");
    const failed = (url: string): Promise<FetchedText> =>
      Promise.resolve({ ok: false, status: 0, url, contentType: null, body: "" });
    const candidates = await aiGenerator(SUBJECT, failed);
    expect(candidates).toHaveLength(1);
    expect(JSON.stringify(run.mock.calls[0])).toContain("Fitness apparel");
  });
});
