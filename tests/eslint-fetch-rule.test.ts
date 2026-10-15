import { describe, expect, it } from "vitest";

import { lintExisting, lintTextAt } from "./eslint-lint-text";

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
