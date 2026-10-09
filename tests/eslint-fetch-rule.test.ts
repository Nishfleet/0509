import { describe, expect, it } from "vitest";

import { lintExisting, lintTextAt } from "./eslint-lint-text";

// #4951: the logo store grew a second outbound-fetch wrapper beside the one in
// app/lib/fetch/transport.server.ts — its own public-host guard, its own
// capped reader, its own copy of the bot user-agent and 8 s deadline, already
// drifted (https-only vs http-or-https, byte cap vs text cap). The transport
// primitives now live in app/lib/fetch/outbound.server.ts and the BARE_FETCH
// selector in eslint.config.js makes a third copy red instead of a review
// note. Client code is exempt (a browser fetch goes to our own origin; SSRF is server-side),
// the same shape DOMAIN_HOSTNAME_BAN landed in 0509#4371. These probes boot
// the real eslint.config.js (same rig as eslint-writer-rule.test.ts).

const FETCH_MESSAGE = "Outbound fetch is owned by app/lib/fetch/";

const BARE_FETCH_CALL = `export async function probe(): Promise<Response> {
  return fetch("https://example.com/logo.png");
}
`;

describe("eslint one-outbound-fetch rule (#4951)", () => {
  it("rejects a bare fetch( under app/lib outside app/lib/fetch", { timeout: 60_000 }, async () => {
    const result = await lintTextAt("app/lib/cadence.ts", BARE_FETCH_CALL);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(FETCH_MESSAGE))).toBe(true);
  });

  it("rejects a bare fetch( in app/lib/identity, where the second copy grew", { timeout: 60_000 }, async () => {
    const result = await lintTextAt("app/lib/identity/confirm.server.ts", BARE_FETCH_CALL);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(FETCH_MESSAGE))).toBe(true);
  });

  it("rejects a bare fetch( in a file that was grandfathered before the migration", { timeout: 60_000 }, async () => {
    for (const file of [
      "app/lib/discovery/start.server.ts",
      "app/lib/hiring/sweep.server.ts",
      "workers/sources/mentions/hn.ts",
    ]) {
      const result = await lintTextAt(file, BARE_FETCH_CALL);
      expect(result.messages.some((m) => m.includes(FETCH_MESSAGE))).toBe(true);
    }
  });

  it("rejects a bare fetch( in workers/", { timeout: 60_000 }, async () => {
    const result = await lintTextAt("workers/workflow-monitor.ts", BARE_FETCH_CALL);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(FETCH_MESSAGE))).toBe(true);
  });

  it("leaves the paved path in app/lib/fetch/ unblocked", { timeout: 60_000 }, async () => {
    const result = await lintTextAt("app/lib/fetch/outbound.server.ts", BARE_FETCH_CALL);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(FETCH_MESSAGE))).toBe(false);
  });

  it("leaves a client component under app/components alone", { timeout: 60_000 }, async () => {
    const result = await lintTextAt("app/components/share-button.tsx", BARE_FETCH_CALL);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(FETCH_MESSAGE))).toBe(false);
  });

  it("leaves the real share button alone", { timeout: 60_000 }, async () => {
    const messages = await lintExisting("app/components/share-button.tsx");
    expect(messages.some((m) => m.includes(FETCH_MESSAGE))).toBe(false);
  });
});
