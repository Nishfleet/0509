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
  applyDraftIntent: vi.fn(),
  confirmCardLater: vi.fn(),
  readWorkspaceIdForOwner: vi.fn(),
  requireFreshSession: vi.fn(),
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
  applyDraftIntent: mocks.applyDraftIntent,
  readDraft: mocks.readDraft,
}));
vi.mock("../../app/lib/discovery/warm.server", () => ({
  warmDiscovery: mocks.warmDiscovery,
}));
vi.mock("../../app/lib/onboarding/card-timing.server", () => ({
  timeCard: (_workspaceId: string, card: { site: unknown; logo: unknown }) => card,
}));
vi.mock("../../app/lib/identity/confirm.server", () => ({
  confirmCardLater: mocks.confirmCardLater,
}));
vi.mock("../../app/lib/data/workspace.server", () => ({
  readWorkspaceIdForOwner: mocks.readWorkspaceIdForOwner,
}));
vi.mock("../../app/lib/client-brands.server", () => ({
  readOtherBrands: vi.fn(() => Promise.resolve([])),
}));
vi.mock("../../app/lib/require-session.server", () => ({
  requireFreshSession: mocks.requireFreshSession,
}));

import { ABOUT_MAX, NAME_MAX } from "../../app/lib/identity/card-fields";
import { action, loader } from "../../app/routes/onboarding.identity";

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
  } as unknown as Parameters<typeof loader>[0]);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.readSubjectAccess.mockResolvedValue(access());
  mocks.readDraft.mockResolvedValue({});
  mocks.startCard.mockReturnValue({
    site: Promise.resolve({}),
    logo: Promise.resolve(null),
    settled: Promise.resolve(),
  });
  mocks.warmDiscovery.mockResolvedValue(undefined);
  mocks.screenOnboardingSubject.mockResolvedValue({ kind: "proceed" });
  mocks.startOnboardingRun.mockResolvedValue(undefined);
  mocks.applyDraftIntent.mockResolvedValue(false);
  mocks.readWorkspaceIdForOwner.mockResolvedValue("ws-1");
  mocks.requireFreshSession.mockResolvedValue({ user: { id: "user-1" } });
  mocks.withinProbeLimit.mockResolvedValue(true);
  mocks.confirmCardLater.mockResolvedValue(() => Promise.resolve("started"));
});

describe("onboarding identity GET paid work", () => {
  it("returns limited without screening, starting a run, probing the site, or warming", async () => {
    mocks.withinProbeLimit.mockResolvedValue(false);

    await expect(load()).resolves.toEqual({ card: null, limited: true, otherBrands: [] });

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

function confirmForm(fields: Record<string, string>): FormData {
  const data = new FormData();
  data.set("subject", "acme.com");
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function confirm(fields: Record<string, string>) {
  return action({
    request: new Request("https://0509.io/onboarding/identity", { method: "POST", body: confirmForm(fields) }),
    context: { get: () => ({ waitUntil: mocks.waitUntil }) },
  } as unknown as Parameters<typeof action>[0]);
}

describe("onboarding identity confirm", () => {
  it("starts the onboarding run for the subject before sending the user to competitors", async () => {
    const thrown: unknown = await confirm({ name: "Acme", description: "" }).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).headers.get("location")).toBe("/onboarding/competitors");
    expect(mocks.startOnboardingRun).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      userId: "user-1",
      inputRaw: "acme.com",
      startedAt: expect.any(String) as unknown,
    });
  });

  it("does not start a run when the confirm fails", async () => {
    mocks.confirmCardLater.mockResolvedValue(null);

    await confirm({ name: "", description: "" });

    expect(mocks.startOnboardingRun).not.toHaveBeenCalled();
  });

  it("asks for a name when the name is empty", async () => {
    mocks.confirmCardLater.mockResolvedValue(null);

    const result = await confirm({ name: "  ", description: "" });

    expect(result).toEqual({ message: "Add your brand's name, then tap Looks right." });
  });

  it("says the name is too long, not missing, for a 3000 character name", async () => {
    mocks.confirmCardLater.mockResolvedValue(null);

    const result = await confirm({ name: "A".repeat(3000), description: "" });

    expect(result).toEqual({ message: `That name is too long. Keep it to ${String(NAME_MAX)} characters or fewer.` });
  });

  it("says the about line is too long when only that field is over the limit", async () => {
    mocks.confirmCardLater.mockResolvedValue(null);

    const result = await confirm({ name: "Acme", description: "b".repeat(ABOUT_MAX + 1) });

    expect(result).toEqual({
      message: `That about line is too long. Keep it to ${String(ABOUT_MAX)} characters or fewer.`,
    });
  });
});
