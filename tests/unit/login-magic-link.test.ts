import { beforeEach, describe, expect, it, vi } from "vitest";

const { handleAuthRequest } = vi.hoisted(() => ({
  handleAuthRequest: vi.fn(async () => new Response("ok", { status: 200 })),
}));

vi.mock("cloudflare:workers", () => ({
  env: {
    BETTER_AUTH_URL: "https://0509.io",
    TURNSTILE_SITE_KEY: "1x00000000000000000000BB",
  },
}));

vi.mock("../../app/lib/auth.server", () => ({
  handleAuthRequest: (env: unknown, request: Request) => handleAuthRequest(env, request),
}));

import { action } from "../../app/routes/login";

function formRequest(fields: Record<string, string>, headers?: HeadersInit): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new Request("https://0509.io/login", { method: "POST", headers, body: form });
}

describe("login magic-link action", () => {
  beforeEach(() => {
    handleAuthRequest.mockReset();
    handleAuthRequest.mockResolvedValue(new Response("ok", { status: 200 }));
  });

  it("asks for an email before it calls the sign-in handler", async () => {
    const result = await action({ request: formRequest({ email: "  " }) });
    expect(result).toEqual({ error: "Enter your email address, then we'll send the link." });
    expect(handleAuthRequest).not.toHaveBeenCalled();
  });

  it("sends the widget token and refuses when the handler does", async () => {
    handleAuthRequest.mockResolvedValue(new Response("Missing CAPTCHA response", { status: 400 }));
    const refused = await action({
      request: formRequest({ email: "Person@0509.io", "cf-turnstile-response": "  token-1  " }),
    });
    expect(refused).toEqual({ error: "Confirm you're a person, then we'll send the link." });
    const forwarded = handleAuthRequest.mock.calls[0]?.[1];
    expect(forwarded).toBeInstanceOf(Request);
    if (!(forwarded instanceof Request)) throw new Error("sign-in handler was not given a request");
    expect(forwarded.headers.get("x-captcha-response")).toBe("token-1");
    expect(await forwarded.json()).toEqual({ email: "person@0509.io", callbackURL: "/app" });
  });

  it("forwards the access service credential when the widget sent no token", async () => {
    const result = await action({
      request: formRequest(
        { email: "agent@0509.io" },
        { cookie: "CF_Authorization=service-jwt", "cf-access-jwt-assertion": "header-jwt", "cf-connecting-ip": "203.0.113.5" },
      ),
    });
    expect(result).toMatchObject({ sent: { email: "agent@0509.io" } });
    const forwarded = handleAuthRequest.mock.calls[0]?.[1];
    if (!(forwarded instanceof Request)) throw new Error("sign-in handler was not given a request");
    expect(forwarded.headers.get("cookie")).toBe("CF_Authorization=service-jwt");
    expect(forwarded.headers.get("cf-access-jwt-assertion")).toBe("header-jwt");
    expect(forwarded.headers.get("cf-connecting-ip")).toBe("203.0.113.5");
    expect(forwarded.headers.get("origin")).toBe("https://0509.io");
    expect(forwarded.headers.get("x-captcha-response")).toBeNull();
  });
});
