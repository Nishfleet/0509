import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function headersBlock(pattern: string): string {
  const headers = readFileSync(join(REPO_ROOT, "public/_headers"), "utf8");
  const lines = headers.split("\n");
  const start = lines.findIndex((line) => line === pattern);
  if (start < 0) {
    throw new Error(`public/_headers has no ${pattern} block`);
  }
  const body: string[] = [];
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (line.length > 0 && !/^\s/.test(line)) break;
    body.push(line);
  }
  return body.join("\n");
}

function headerValue(block: string, name: string): string | undefined {
  const line = block
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.toLowerCase().startsWith(`${name.toLowerCase()}:`));
  return line?.slice(line.indexOf(":") + 1).trim();
}

describe("static asset headers", () => {
  it("sends the four security headers on every static asset", () => {
    const all = headersBlock("/*");
    expect(headerValue(all, "Content-Security-Policy")).toBeDefined();
    expect(headerValue(all, "Strict-Transport-Security")).toContain("max-age=31536000");
    expect(headerValue(all, "X-Frame-Options")).toBe("DENY");
    expect(headerValue(all, "Referrer-Policy")).toBe("same-origin");
  });

  it("allows no inline script and no framing in the static CSP", () => {
    const csp = headerValue(headersBlock("/*"), "Content-Security-Policy");
    expect(csp).toContain("script-src 'self';");
    expect(csp).not.toContain("sha256-");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it("leaves the homepage cache policy to the Worker, which sends no-transform", () => {
    const headers = readFileSync(join(REPO_ROOT, "public/_headers"), "utf8");
    expect(headers.split("\n")).not.toContain("/");
  });

  it.each(["/og.png", "/logo.svg", "/favicon.ico", "/apple-touch-icon.png", "/app-faces.css", "/home-faces.css"])(
    "caches %s so a repeat visit does not revalidate it",
    (path) => {
      expect(headerValue(headersBlock(path), "Cache-Control")).toBe("public, max-age=86400");
    },
  );
});
