import { data } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { handler } = vi.hoisted(() => ({
  handler: vi.fn(async () => new Response("ok", { status: 200 })),
}));

vi.mock("cloudflare:workers", () => ({
  env: {
    BETTER_AUTH_URL: "https://0509.io",
    TURNSTILE_SITE_KEY: "1x00000000000000000000BB",
  },
}));

vi.mock("../../app/lib/auth.server", () => ({
  createAuthForRequest: async () => ({ handler }),
}));

import { action } from "../../app/routes/login";

function formRequest(
  fields: Record<string, string>,
  headers?: HeadersInit,
  url = "https://0509.io/login",
): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new Request(url, { method: "POST", headers, body: form });
}

async function sentCallbackURL(): Promise<unknown> {
  const call = handler.mock.calls[0];
  if (call === undefined) throw new Error("sign-in handler was not called");
  const forwarded = call[0];
  if (!(forwarded instanceof Request)) throw new Error("sign-in handler was not given a request");
  return (await forwarded.json()) as unknown;
}

describe("login magic-link action", () => {
  beforeEach(() => {
    handler.mockReset();
    handler.mockResolvedValue(new Response("ok", { status: 200 }));
  });

  it("asks for an email before it calls the sign-in handler", async () => {
    const result = await action({ request: formRequest({ email: "  " }) });
    expect(result).toEqual({ error: "Enter your email address, then we'll send the link." });
    expect(handler).not.toHaveBeenCalled();
  });

  it("sends the widget token and refuses when the handler does", async () => {
    handler.mockResolvedValue(new Response("Missing CAPTCHA response", { status: 400 }));
    const refused = await action({
      request: formRequest({ email: "Person@0509.io", "cf-turnstile-response": "  token-1  " }),
    });
    expect(refused).toEqual({ error: "Confirm you're a person, then we'll send the link." });
    const call = handler.mock.calls[0];
    if (call === undefined) throw new Error("sign-in handler was not called");
    const forwarded = call[0];
    if (!(forwarded instanceof Request)) throw new Error("sign-in handler was not given a request");
    expect(forwarded.url).toBe("https://0509.io/api/auth/sign-in/magic-link");
    expect(forwarded.headers.get("x-captcha-response")).toBe("token-1");
    expect(forwarded.headers.get("origin")).toBe("https://0509.io");
    expect(await forwarded.json()).toEqual({ email: "person@0509.io", callbackURL: "/app" });
  });

  it("carries the hero subject into the link's return address", async () => {
    await action({
      request: formRequest({ email: "person@0509.io" }, undefined, "https://0509.io/login?subject=gymshark.com"),
    });
    expect(await sentCallbackURL()).toEqual({
      email: "person@0509.io",
      callbackURL: "/onboarding/identity?subject=gymshark.com",
    });
  });

  it("keeps the return address inside the app when the subject is hostile", async () => {
    await action({
      request: formRequest(
        { email: "person@0509.io" },
        undefined,
        "https://0509.io/login?subject=https%3A%2F%2Fevil.example",
      ),
    });
    expect(await sentCallbackURL()).toEqual({
      email: "person@0509.io",
      callbackURL: "/onboarding/identity?subject=https%3A%2F%2Fevil.example",
    });
  });

  it("lets an explicit next win over a hero subject", async () => {
    await action({
      request: formRequest(
        { email: "person@0509.io" },
        undefined,
        "https://0509.io/login?next=/oauth/authorize%3Fclient_id%3Dx&subject=gymshark.com",
      ),
    });
    expect(await sentCallbackURL()).toEqual({
      email: "person@0509.io",
      callbackURL: "/oauth/authorize?client_id=x",
    });
  });

  it("treats a blank subject as no subject", async () => {
    await action({
      request: formRequest({ email: "person@0509.io" }, undefined, "https://0509.io/login?subject="),
    });
    expect(await sentCallbackURL()).toEqual({ email: "person@0509.io", callbackURL: "/app" });
  });

  it("forwards the client ip and does not invent a captcha header", async () => {
    const result = await action({
      request: formRequest({ email: "agent@0509.io" }, { "cf-connecting-ip": "203.0.113.5" }),
    });
    expect(result).toMatchObject({ sent: { email: "agent@0509.io" } });
    const call = handler.mock.calls[0];
    if (call === undefined) throw new Error("sign-in handler was not called");
    const forwarded = call[0];
    if (!(forwarded instanceof Request)) throw new Error("sign-in handler was not given a request");
    expect(forwarded.headers.get("cf-connecting-ip")).toBe("203.0.113.5");
    expect(forwarded.headers.get("x-captcha-response")).toBeNull();
    expect(forwarded.headers.get("cf-access-jwt-assertion")).toBeNull();
  });

  it("does not say the link was sent when the handler fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      handler.mockResolvedValue(new Response("account daily sending quota exceeded", { status: 500 }));
      const result = await action({ request: formRequest({ email: "person@0509.io", "cf-turnstile-response": "token-1" }) });
      expect(result).toEqual(
        data({ error: "We couldn't send the link. Try again in a minute." }, { status: 503 }),
      );
      expect(result).not.toHaveProperty("sent");
      const text = logged.mock.calls.map((call) => String(call[0])).join("\n");
      expect(text).toContain("login.magic_link_send_failed");
      expect(text).toContain('"status":500');
      expect(text).not.toContain("account daily sending quota exceeded");
    } finally {
      logged.mockRestore();
    }
  });

  it("logs a provider message without the address that was in it", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      handler.mockResolvedValue(
        new Response("account daily sending quota exceeded for victim@example.com", { status: 500 }),
      );
      await action({ request: formRequest({ email: "person@0509.io", "cf-turnstile-response": "token-1" }) });
      const text = logged.mock.calls.map((call) => String(call[0])).join("\n");
      expect(text).toContain("login.magic_link_send_failed");
      expect(text).toContain('"status":500');
      expect(text).not.toContain("victim@example.com");
      expect(text).not.toContain("person@0509.io");
    } finally {
      logged.mockRestore();
    }
  });

  it("does not call a bad email a failed captcha", async () => {
    handler.mockResolvedValue(new Response('{"message":"Invalid email"}', { status: 400 }));
    const result = await action({
      request: formRequest({ email: "person@0509.io", "cf-turnstile-response": "token-1" }),
    });
    expect(result).toEqual({ error: "Enter an email address we can send the link to." });
  });

  it("names the rate limit when the handler is too busy", async () => {
    handler.mockResolvedValue(new Response("Too many sign-in links. Wait a minute and try again.", { status: 429 }));
    const result = await action({ request: formRequest({ email: "person@0509.io", "cf-turnstile-response": "token-1" }) });
    expect(result).toEqual({ error: "Too many sign-in links. Wait a minute and try again." });
  });
});
