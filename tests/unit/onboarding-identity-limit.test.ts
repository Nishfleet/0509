import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readSubjectAccess: vi.fn(),
  withinProbeLimit: vi.fn(),
  screenOnboardingSubject: vi.fn(),
  startOnboardingRun: vi.fn(),
  readDraft: vi.fn(),
  startCard: vi.fn(),
  warmDiscovery: vi.fn(),
  waitUntil: vi.fn(),
}));

vi.mock("@sentry/cloudflare", () => ({ captureException: vi.fn() }));
vi.mock("../../app/lib/onboarding/subject-access.server", () => ({
  readSubjectAccess: mocks.readSubjectAccess,
}));
vi.mock("../../app/lib/identity/card.server", () => ({
  startCard: mocks.startCard,
  withinProbeLimit: mocks.withinProbeLimit,
}));
vi.mock("../../app/lib/onboarding-screen.server", () => ({
  screenOnboardingSubject: mocks.screenOnboardingSubject,
}));
vi.mock("../../app/lib/data/onboarding_run.server", () => ({
  startOnboardingRun: mocks.startOnboardingRun,
}));
vi.mock("../../app/lib/identity/card-draft.server", () => ({
  applyDraftIntent: vi.fn(),
  readDraft: mocks.readDraft,
}));
vi.mock("../../app/lib/discovery/warm.server", () => ({
  warmDiscovery: mocks.warmDiscovery,
}));
vi.mock("../../app/lib/onboarding/card-timing.server", () => ({
  timeCard: (_workspaceId: string, card: { site: unknown; logo: unknown }) => card,
}));
vi.mock("../../app/lib/identity/confirm.server", () => ({
  confirmCardLater: vi.fn(),
}));
vi.mock("../../app/lib/data/workspace.server", () => ({
  readWorkspaceIdForOwner: vi.fn(),
}));
vi.mock("../../app/lib/require-session.server", () => ({
  requireFreshSession: vi.fn(),
}));

import { loader } from "../../app/routes/onboarding.identity";

const SUBJECT = {
  kind: "domain" as const,
  registrable: "acme.com",
  url: "https://acme.com",
};

function access() {
  return {
    raw: "acme.com",
    subject: SUBJECT,
    taken: false,
    landing: "/onboarding/identity?subject=acme.com",
    workspaceId: "ws-1",
    userId: "user-1",
  };
}

function load() {
  return loader({
    request: new Request("https://0509.io/onboarding/identity?subject=acme.com"),
    context: { get: () => ({ waitUntil: mocks.waitUntil }) },
  } as Parameters<typeof loader>[0]);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.readSubjectAccess.mockResolvedValue(access());
  mocks.readDraft.mockResolvedValue({});
  mocks.startCard.mockReturnValue({ site: Promise.resolve({}), logo: Promise.resolve(null) });
  mocks.warmDiscovery.mockResolvedValue(undefined);
  mocks.screenOnboardingSubject.mockResolvedValue({ kind: "proceed" });
  mocks.startOnboardingRun.mockResolvedValue(undefined);
});

describe("onboarding identity GET paid work", () => {
  it("returns limited without screening, starting a run, probing the site, or warming", async () => {
    mocks.withinProbeLimit.mockResolvedValue(false);

    await expect(load()).resolves.toEqual({ card: null, limited: true });

    expect(mocks.withinProbeLimit).toHaveBeenCalledWith("user-1");
    expect(mocks.screenOnboardingSubject).not.toHaveBeenCalled();
    expect(mocks.startOnboardingRun).not.toHaveBeenCalled();
    expect(mocks.startCard).not.toHaveBeenCalled();
    expect(mocks.warmDiscovery).not.toHaveBeenCalled();
  });

  it("does not screen or start a run on GET once the user is under the limit", async () => {
    mocks.withinProbeLimit.mockResolvedValue(true);

    await load();

    expect(mocks.withinProbeLimit).toHaveBeenCalledWith("user-1");
    expect(mocks.screenOnboardingSubject).not.toHaveBeenCalled();
    expect(mocks.startOnboardingRun).not.toHaveBeenCalled();
    expect(mocks.startCard).toHaveBeenCalled();
  });
});
