import { captureException } from "@sentry/cloudflare";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendLifecycleEmails } from "../../workers/delivery/lifecycle";
import { reportLifecycleFailure } from "../../workers/delivery/lifecycle-failure";

vi.mock("@sentry/cloudflare", () => ({ captureException: vi.fn() }));
vi.mock("../../workers/delivery/welcome", () => ({
  sendWelcomes: () => Promise.reject(new Error("welcome query down for ada@example.com")),
}));
vi.mock("../../workers/delivery/recap", () => ({ sendRecaps: () => Promise.resolve(0) }));
vi.mock("../../workers/delivery/monthly", () => ({ sendMonthlies: () => Promise.resolve(0) }));
vi.mock("../../workers/delivery/winback", () => ({ sendWinbacks: () => Promise.resolve(0) }));
vi.mock("../../workers/delivery/rival-nudge", () => ({ sendRivalNudges: () => Promise.resolve(0) }));

describe("lifecycle email failures", () => {
  beforeEach(() => {
    vi.mocked(captureException).mockClear();
  });

  it("reaches Sentry, without the customer's address", () => {
    reportLifecycleFailure("delivery.welcome_failed", new Error("rejected ada@example.com"));
    expect(captureException).toHaveBeenCalledTimes(1);
    const reported = vi.mocked(captureException).mock.calls[0]?.[0];
    expect(String(reported)).not.toContain("ada@example.com");
  });

  it("reaches Sentry when a whole lifecycle sender throws, and the others still run", async () => {
    await sendLifecycleEmails({} as Env, new Date("2026-10-15T10:00:00Z"));
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(captureException).mock.calls[0]?.[0])).toContain("delivery.welcome_cron_failed");
  });
});
