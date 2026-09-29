import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
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

describe("static home analytics", () => {
  it("sets no-transform on / so the edge cannot inject the analytics module", () => {
    const html = readFileSync(join(REPO_ROOT, "public/index.html"), "utf8");
    const cacheControl = headerValue(headersBlock("/"), "Cache-Control");
    if (cacheControl === undefined) {
      throw new Error("public/_headers / block has no Cache-Control");
    }
    const directives = cacheControl
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    expect(directives).toContain("public");
    expect(directives).toContain("max-age=300");
    expect(directives).toContain("no-transform");
    expect(html).toContain("Quietly, we");
    expect(html).not.toContain("<script src");
    expect(html).not.toContain("cloudflareinsights.com");
    expect(html).toContain('addEventListener("load"');
    expect(Buffer.byteLength(html)).toBeLessThan(8_000);
  });

  // 0509#5758 / audit V16. `/` is served by the static-assets pipeline, not by
  // app/entry.server.tsx, so it is the only HTML page on the origin with no
  // security headers at all. The four the launch audit names are asserted here
  // against the `/*` block, which Cloudflare applies to every static asset in
  // addition to the more specific Cache-Control blocks ("an incoming request
  // which matches multiple rules' URL patterns will inherit all rules'
  // headers").
  it("sends the four security headers on every static asset", () => {
    const all = headersBlock("/*");
    expect(headerValue(all, "Content-Security-Policy")).toBeDefined();
    expect(headerValue(all, "Strict-Transport-Security")).toContain("max-age=31536000");
    expect(headerValue(all, "X-Frame-Options")).toBe("DENY");
    expect(headerValue(all, "Referrer-Policy")).toBe("same-origin");
    expect(headerValue(all, "X-Content-Type-Options")).toBe("nosniff");
  });

  // The one script the static home ships is inline and load-bearing: it appends
  // /home-faces.css after the headline paints (0509#5630), and the eslint rule
  // in eslint.config.js forbids replacing it with a <link>. A static _headers
  // file cannot carry the Worker's per-response nonce, so the only way to keep
  // a real script-src is the script's SHA-256. If the inline script is ever
  // edited, the CSP hash goes stale and the browser blocks the font load — a
  // silent failure. This test recomputes the hash from the HTML, so the two
  // cannot drift: edit the script and this goes red until the hash is updated.
  it("pins the inline script by hash in the static CSP", () => {
    const html = readFileSync(join(REPO_ROOT, "public/index.html"), "utf8");
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    if (script === undefined) {
      throw new Error("public/index.html has no inline <script>");
    }
    const digest = createHash("sha256").update(Buffer.from(script, "utf8")).digest("base64");
    const csp = headerValue(headersBlock("/*"), "Content-Security-Policy");
    expect(csp).toContain(`'sha256-${digest}'`);
  });
});
