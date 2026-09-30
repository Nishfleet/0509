import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// #4951: the logo store grew a second outbound-fetch wrapper beside the one in
// app/lib/fetch/transport.server.ts — its own public-host guard, its own
// capped reader, its own copy of the bot user-agent and 8 s deadline, already
// drifted (https-only vs http-or-https, byte cap vs text cap). The transport
// primitives now live in app/lib/fetch/outbound.server.ts and the BARE_FETCH
// selector in eslint.config.js makes a third copy red instead of a review
// note. Client code is exempt (a browser fetch goes to our own origin; SSRF is server-side),
// the same shape DOMAIN_HOSTNAME_BAN landed in 0509#4371. These probes boot
// the real eslint.config.js (same rig as eslint-writer-rule.test.ts).

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const FETCH_MESSAGE = "Outbound fetch is owned by app/lib/fetch/";

const BARE_FETCH_CALL = `export async function probe(): Promise<Response> {
  return fetch("https://example.com/logo.png");
}
`;

async function lintProbe(rel: string, code: string): Promise<{ ignored: boolean; messages: string[] }> {
  const file = path.join(REPO_ROOT, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, code);
  try {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    if (await eslint.isPathIgnored(file)) {
      return { ignored: true, messages: [] };
    }
    const results = await eslint.lintFiles([file]);
    return {
      ignored: false,
      messages: results.flatMap((result) => result.messages.map((m) => m.message)),
    };
  } finally {
    await rm(file, { force: true });
  }
}

async function lintExisting(rel: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  const results = await eslint.lintFiles([path.join(REPO_ROOT, rel)]);
  return results.flatMap((result) => result.messages.map((m) => m.message));
}

describe("eslint one-outbound-fetch rule (#4951)", () => {
  it("rejects a bare fetch( under app/lib outside app/lib/fetch", { timeout: 60_000 }, async () => {
    const result = await lintProbe("app/lib/probe-fetch-tmp.server.ts", BARE_FETCH_CALL);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(FETCH_MESSAGE))).toBe(true);
  });

  it("rejects a bare fetch( in app/lib/identity, where the second copy grew", { timeout: 60_000 }, async () => {
    const result = await lintProbe("app/lib/identity/probe-fetch-tmp.server.ts", BARE_FETCH_CALL);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(FETCH_MESSAGE))).toBe(true);
  });

  it("rejects a bare fetch( in a file that was grandfathered before the migration", { timeout: 60_000 }, async () => {
    for (const file of [
      "app/lib/discovery/probe-fetch-tmp.server.ts",
      "app/lib/hiring/probe-fetch-tmp.server.ts",
      "workers/sources/mentions/probe-fetch-tmp.ts",
    ]) {
      const result = await lintProbe(file, BARE_FETCH_CALL);
      expect(result.messages.some((m) => m.includes(FETCH_MESSAGE))).toBe(true);
    }
  });

  it("rejects a bare fetch( in workers/", { timeout: 60_000 }, async () => {
    const result = await lintProbe("workers/probe-fetch-tmp.ts", BARE_FETCH_CALL);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(FETCH_MESSAGE))).toBe(true);
  });

  it("leaves the paved path in app/lib/fetch/ unblocked", { timeout: 60_000 }, async () => {
    const result = await lintProbe("app/lib/fetch/probe-fetch-tmp.server.ts", BARE_FETCH_CALL);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(FETCH_MESSAGE))).toBe(false);
  });

  it("leaves a client component under app/components alone", { timeout: 60_000 }, async () => {
    const result = await lintProbe("app/components/probe-fetch-tmp.tsx", BARE_FETCH_CALL);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(FETCH_MESSAGE))).toBe(false);
  });

  it("leaves the real share button alone", { timeout: 60_000 }, async () => {
    const messages = await lintExisting("app/components/share-button.tsx");
    expect(messages.some((m) => m.includes(FETCH_MESSAGE))).toBe(false);
  });
});
