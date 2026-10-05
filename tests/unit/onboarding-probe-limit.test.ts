import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireFreshSession: vi.fn(),
  isTakenDown: vi.fn(),
  readWorkspaceIdForOwner: vi.fn(),
  screenOnboardingSubject: vi.fn(),
  startOnboardingRun: vi.fn(),
  withinProbeLimit: vi.fn(),
  workspaceLandingForRequest: vi.fn(),
  requireSession: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("../../app/lib/require-session.server", () => ({
  requireFreshSession: mocks.requireFreshSession,
  requireSession: mocks.requireSession,
}));
vi.mock("../../app/lib/data/takedown.server", () => ({
  isTakenDown: mocks.isTakenDown,
}));
vi.mock("../../app/lib/data/workspace.server", () => ({
  readWorkspaceIdForOwner: mocks.readWorkspaceIdForOwner,
}));
vi.mock("../../app/lib/onboarding-screen.server", () => ({
  screenOnboardingSubject: mocks.screenOnboardingSubject,
}));
vi.mock("../../app/lib/data/onboarding_run.server", () => ({
  startOnboardingRun: mocks.startOnboardingRun,
}));
vi.mock("../../app/lib/identity/card.server", () => ({
  withinProbeLimit: mocks.withinProbeLimit,
}));
vi.mock("../../app/lib/workspace.server", () => ({
  ONBOARDING_COMPETITORS: "/onboarding/competitors",
  workspaceLandingForRequest: mocks.workspaceLandingForRequest,
}));
vi.mock("../../app/lib/use-timezone-cookie", () => ({
  useTimezoneCookie: () => undefined,
}));

import { action } from "../../app/routes/onboarding";

function post(subject: string) {
  const form = new FormData();
  form.set("subject", subject);
  return action({
    request: new Request("https://0509.io/onboarding", { method: "POST", body: form }),
  } as Parameters<typeof action>[0]);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireFreshSession.mockResolvedValue({ user: { id: "user-1" } });
  mocks.isTakenDown.mockResolvedValue(false);
  mocks.readWorkspaceIdForOwner.mockResolvedValue("ws-1");
  mocks.screenOnboardingSubject.mockResolvedValue({ kind: "proceed" });
  mocks.startOnboardingRun.mockResolvedValue(undefined);
});

describe("onboarding POST paid work", () => {
  it("returns limited without screening or starting a run", async () => {
    mocks.withinProbeLimit.mockResolvedValue(false);

    await expect(post("acme.com")).resolves.toEqual({
      message: "You've tried a lot of addresses in the last minute. Wait a minute, then try again.",
      confirm: null,
    });

    expect(mocks.withinProbeLimit).toHaveBeenCalledWith("user-1");
    expect(mocks.screenOnboardingSubject).not.toHaveBeenCalled();
    expect(mocks.startOnboardingRun).not.toHaveBeenCalled();
  });
});
