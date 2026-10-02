import { afterEach, describe, expect, it, vi } from "vitest";

import { postToSlack } from "../../app/lib/slack.server";

const HOOK = "https://hooks.slack.com/services/T0SECRET/B0SECRET/xoxSECRETTOKEN";

afterEach(() => {
  vi.restoreAllMocks();
});

function loggedText(...spies: ReturnType<typeof vi.spyOn>[]): string {
  return JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
}

describe("postToSlack", () => {
  it("answers true when Slack accepts the post", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok", { status: 200 }));
    expect(await postToSlack(HOOK, "hello")).toBe(true);
  });

  it("answers false when Slack refuses the post", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("no_service", { status: 404 }));
    expect(await postToSlack(HOOK, "hello")).toBe(false);
  });

  it("never writes the webhook address to a log when a redirect cannot be followed", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "http://[" } }),
    );

    expect(await postToSlack(HOOK, "hello")).toBe(false);

    const written = loggedText(error, log);
    expect(written).toContain("slack.post_failed");
    expect(written).not.toContain("SECRET");
    expect(written).not.toContain("hooks.slack.com");
  });

  it("never writes the webhook address to a log when the network fails with it in the message", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError(`failed to fetch ${HOOK}`));

    expect(await postToSlack(HOOK, "hello")).toBe(false);
    expect(loggedText(error)).not.toContain("SECRET");
  });
});
