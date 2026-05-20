import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const loginRoute = readFileSync("app/routes/auth.login.tsx", "utf8");
const signupRoute = readFileSync("app/routes/auth.signup.tsx", "utf8");
const authForm = readFileSync("app/components/auth-form.tsx", "utf8");
const authSurface = `${loginRoute}\n${signupRoute}\n${authForm}`;
const authClasses = Array.from(
  authSurface.matchAll(/className=(?:"([^"]+)"|{`([^`]+)`})/g),
).flatMap((match) =>
  (match[1] ?? match[2])
    .split(/\s+/)
    .map((className) => className.replace(/\$\{[^}]+\}/g, "").trim())
    .filter(Boolean),
);

describe("auth rebuild", () => {
  it("uses the fresh auth surface instead of the legacy auth system", () => {
    expect(authSurface).toContain('className="f9-auth-page"');
    expect(authClasses).not.toEqual(
      expect.arrayContaining([
        "auth-shell",
        "auth-grid",
        "auth-aside",
        "auth-card",
        "auth-copy",
        "auth-switch",
        "brand-mark",
        "brand-pill",
        "button-primary",
        "button-secondary",
        "stack-form",
        "field",
        "eyebrow",
        "bullet-list",
      ]),
    );
  });

  it("keeps stale launch framing out of auth", () => {
    expect(authSurface).not.toMatch(/pilot|beta|manual|fit review|self-serve|not live/i);
  });

  it("uses the Five to Nine wordmark in auth", () => {
    expect(authSurface).toContain("<BrandWordmark />");
  });
});
