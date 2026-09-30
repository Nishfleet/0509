import { describe, expect, it } from "vitest";

import { withTransportSecurityHeaders } from "../app/lib/security-headers";

const HSTS = "max-age=31536000; includeSubDomains";

describe("withTransportSecurityHeaders", () => {
  it("adds nosniff and HSTS to a JSON response and keeps body and status", async () => {
    const out = withTransportSecurityHeaders(Response.json({ ok: true }, { status: 201 }));
    expect(out.status).toBe(201);
    expect(out.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(out.headers.get("Strict-Transport-Security")).toBe(HSTS);
    expect(out.headers.get("Content-Type")).toContain("application/json");
    expect(await out.json()).toEqual({ ok: true });
  });

  it("returns the same response when both headers exist", () => {
    const original = new Response("x", {
      headers: { "X-Content-Type-Options": "nosniff", "Strict-Transport-Security": "max-age=1" },
    });
    const out = withTransportSecurityHeaders(original);
    expect(out).toBe(original);
    expect(out.headers.get("Strict-Transport-Security")).toBe("max-age=1");
  });

  it("only fills the missing header without duplicating", () => {
    const out = withTransportSecurityHeaders(new Response("x", { headers: { "X-Content-Type-Options": "nosniff" } }));
    expect(out.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(out.headers.get("Strict-Transport-Security")).toBe(HSTS);
  });

  it("preserves redirects", () => {
    const out = withTransportSecurityHeaders(Response.redirect("https://0509.io/app", 302));
    expect(out.status).toBe(302);
    expect(out.headers.get("Location")).toBe("https://0509.io/app");
    expect(out.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
