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
  createAuth: () => ({ handler }),
}));

import { action } from "../../app/routes/login";

function formRequest(fields: Record<string, string>, headers?: HeadersInit): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new Request("https://0509.io/login", { method: "POST", headers, body: form });
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
    handler.mockResolvedValue(new Response("send failed", { status: 500 }));
    const result = await action({ request: formRequest({ email: "person@0509.io", "cf-turnstile-response": "token-1" }) });
    expect(result).toEqual({ error: "We couldn't send the link. Try again in a minute." });
    expect(result).not.toHaveProperty("sent");
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
