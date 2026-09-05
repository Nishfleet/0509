import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Wiring tests for the AI weekly strategy paragraph in runDigests:
 * generation gating (plan/cadence), persistence BEFORE delivery, and the
 * never-regenerate rule for existing runs and the retry sweep.
 */

const GOOD_PARAGRAPH =
"boAt refreshed the offer on its landing page, which was the only logged movement this week. " +
"Pricing and offer positioning is where the competitive pressure is concentrated right now.";

const STORED_PARAGRAPH =
"Stored paragraph from the original generation: boAt moved its landing page offer and nothing else changed across the watched competitors this week.";

function weeklyEvent() {
return {
id: "event-1",
eventType: "landing_page_offer_changed",
status: "confirmed",
importanceScore: 79,
proofCaptureId: "proof-1",
title: "Landing page offer changed",
summary: "Offer changed on the landing page.",
confirmedAt: "2026-07-12T05:00:00.000Z",
createdAt: "2026-07-12T05:00:00.000Z",
metadata: {},
};
}

function provisionalEvent() {
return {
id: "event-provisional",
eventType: "landing_page_cta_changed",
status: "proof_pending",
importanceScore: 95,
proofCaptureId: null,
title: "Possible CTA change",
summary: "A high-priority CTA change is still waiting on proof.",
confirmedAt: null,
createdAt: "2026-07-12T06:00:00.000Z",
metadata: {},
};
}

function dataServerMock(overrides: Record<string, unknown> = {}) {
let digestScheduleJobs = [{
id: "digest-job-user-1",
userId: "user-1",
userEmail: "owner@example.com",
userName: "Owner",
cadence: "weekly",
periodStart: "2026-07-06T05:00:00.000Z",
periodEnd: "2026-07-13T05:00:00.000Z",
attemptCount: 0,
}];
return {
addDigestItem: vi.fn(),
claimDigestStrategyGenerationLease: vi.fn().mockResolvedValue(true),
clearDigestItems: vi.fn(),
completeDigestStrategyGeneration: vi.fn().mockResolvedValue(true),
createAdObservation: vi.fn(),
getWorkspaceDeliveryConfig: vi.fn().mockResolvedValue(null),
  createDigestRun: vi.fn().mockResolvedValue({ digestRunId: "digest-1", created: true }),
createEventCandidate: vi.fn(),
createLandingPageSnapshot: vi.fn(),
createProofCapture: vi.fn(),
createWatchEvent: vi.fn(),
createWatchlistRun: vi.fn(),
countProofCapturesForWatchlistSince: vi.fn(),
countProofCapturesForWorkspaceSince: vi.fn(),
finishWatchlistRun: vi.fn(),
claimDigestScheduleJob: vi.fn().mockImplementation(
async (_env: unknown, input: { jobId: string }) =>
digestScheduleJobs.find((job) => job.id === input.jobId) ?? null,
),
completeDigestScheduleJob: vi.fn().mockResolvedValue(true),
enqueueDigestScheduleJobs: vi.fn().mockImplementation(
async (
_env: unknown,
input: { cadence: "daily" | "weekly"; periodStart: string; periodEnd: string },
) => {
digestScheduleJobs = [{
...digestScheduleJobs[0]!,
cadence: input.cadence,
periodStart: input.periodStart,
periodEnd: input.periodEnd,
}];
return 1;
},
),
exhaustStaleMaxAttemptDigestScheduleJobs: vi.fn().mockResolvedValue(0),
failDigestScheduleJob: vi.fn().mockResolvedValue(true),
getDigestByPeriod: vi.fn().mockResolvedValue(null),
getDigest: vi.fn().mockResolvedValue(null),
getSuccessfulRunStatsForUserBetween: vi.fn().mockResolvedValue({
runs: 0,
watchlistsChecked: 0,
adsSeen: 0,
}),
listRetryableDigestRuns: vi.fn().mockResolvedValue([]),
listRetryableDigestScheduleJobs: vi.fn().mockResolvedValue(digestScheduleJobs),
getUserDeliveryProfile: vi.fn(),
hasInFlightWatchlistRun: vi.fn().mockResolvedValue(false),
getRecentSuccessfulRuns: vi.fn(),
getSavedQuery: vi.fn(),
getWatchlist: vi.fn(),
hydrateAdsWithPersistedCreatives: vi.fn(),
listActiveWatchlists: vi.fn(),
listProofCapturesForTarget: vi.fn(),
listProofCapturesForTargets: vi.fn().mockResolvedValue(new Map()),
listLastSuccessfulProofCapturesForAds: vi.fn().mockResolvedValue(new Map()),
listRecentWorkspaceProofCaptures: vi.fn(),
listSuccessfulProofCapturesForAd: vi.fn(),
listObservationsForRun: vi.fn(),
listWatchEvents: vi.fn(),
listAdsByIds: vi.fn().mockResolvedValue([]),
listWatchEventsBetween: vi.fn().mockResolvedValue([weeklyEvent()]),
listWatchlists: vi.fn().mockResolvedValue([{ id: "watch-1", name: "boAt watch" }]),
logMetaIntegrationStatus: vi.fn(),
touchWatchlistScanned: vi.fn(),
updateDigestRunSummary: vi.fn(),
upsertProofTarget: vi.fn(),
upsertAd: vi.fn(),
upsertDigestDelivery: vi.fn(),
...overrides,
};
}

function planServerMock(plan: string) {
return {
getUserPlan: vi.fn().mockResolvedValue(plan),
PLAN_LIMITS: {
free: { digests: false, digestCadence: "none" },
scout: { digests: true, digestCadence: "weekly" },
starter: { digests: true, digestCadence: "weekly" },
agency: { digests: true, digestCadence: "daily_and_weekly" },
},
};
}

function envWith(aiRun: ReturnType<typeof vi.fn> | null, users: unknown[] = [
{ id: "user-1", email: "owner@example.com", name: "Owner" },
]) {
return {
...(aiRun ? { AI: { run: aiRun } } : {}),
DB: {
prepare() {
return {
async all<T>() {
return { results: users as T[] };
},
bind() {
return {
async all<T>() {
return { results: users as T[] };
},
};
},
};
},
},
} as never;
}

beforeEach(() => {
vi.resetModules();
});

afterEach(() => {
vi.restoreAllMocks();
vi.resetModules();
});

describe("weekly digest strategy paragraph flow", () => {
it("claims the atomic snapshot before AI, persists strategy, then delivers", async () => {
const data = dataServerMock();
const deliverWeeklyDigest = vi.fn().mockResolvedValue({ attempts: 1, channels: ["email"] });
const aiRun = vi.fn().mockResolvedValue(GOOD_PARAGRAPH);

vi.doMock("~/lib/auth.server", () => ({}));
vi.doMock("~/lib/data.server", () => data);
vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest }));
vi.doMock("~/lib/plan.server", () => planServerMock("starter"));

const { runWeeklyDigests } = await import("~/lib/monitoring.server");
const result = await runWeeklyDigests(envWith(aiRun), { periodEnd: "2026-07-13T05:00:00.000Z" });

expect(result).toBe(1);
expect(aiRun).toHaveBeenCalledTimes(1);
expect(data.createDigestRun).toHaveBeenCalledWith(
expect.anything(),
"user-1",
expect.any(String),
expect.any(String),
expect.objectContaining({
totalEvents: 1,
watchlists: 1,
}),
expect.objectContaining({
returnClaim: true,
items: [
expect.objectContaining({
watchlistId: "watch-1",
eventType: "landing_page_offer_changed",
}),
],
}),
);
expect(data.createDigestRun.mock.calls[0]?.[4]).not.toHaveProperty("strategyParagraph");
expect(data.completeDigestStrategyGeneration).toHaveBeenCalledWith(
expect.anything(),
"digest-1",
expect.objectContaining({
leaseId: expect.any(String),
summary: expect.objectContaining({
totalEvents: 1,
strategyGenerationStatus: "ready",
strategyParagraph: GOOD_PARAGRAPH,
strategyModel: "@cf/meta/llama-3.2-3b-instruct",
strategyGeneratedAt: expect.any(String),
strategyWatchlistIds: ["watch-1"],
}),
}),
);
expect(data.createDigestRun.mock.invocationCallOrder[0]).toBeLessThan(
aiRun.mock.invocationCallOrder[0]!,
);
expect(aiRun.mock.invocationCallOrder[0]).toBeLessThan(
data.completeDigestStrategyGeneration.mock.invocationCallOrder[0]!,
);
expect(data.completeDigestStrategyGeneration.mock.invocationCallOrder[0]).toBeLessThan(
deliverWeeklyDigest.mock.invocationCallOrder[0]!,
);
expect(deliverWeeklyDigest).toHaveBeenCalledWith(
expect.anything(),
expect.objectContaining({
digestRunId: "digest-1",
strategyParagraph: GOOD_PARAGRAPH,
totalEligibleEvents: 1,
includedEvents: 1,
omittedEvents: 0,
}),
);
});

it("persists the full eligible cohort while delivering only the capped digest", async () => {
const events = Array.from({ length: 4_200 }, (_, index) => ({
...weeklyEvent(),
id: `event-${index}`,
title: `Change ${index}`,
summary: `Summary ${index}`,
importanceScore: index % 101,
}));
const data = dataServerMock({
listWatchEventsBetween: vi.fn().mockResolvedValue(events),
});
const deliverWeeklyDigest = vi.fn().mockResolvedValue({ attempts: 1, channels: ["email"] });
const aiRun = vi.fn().mockResolvedValue(GOOD_PARAGRAPH);

vi.doMock("~/lib/auth.server", () => ({}));
vi.doMock("~/lib/data.server", () => data);
vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest }));
vi.doMock("~/lib/plan.server", () => planServerMock("starter"));

const { runWeeklyDigests } = await import("~/lib/monitoring.server");
await expect(runWeeklyDigests(envWith(aiRun), { periodEnd: "2026-07-13T05:00:00.000Z" })).resolves.toBe(1);

expect(data.createDigestRun).toHaveBeenCalledWith(
expect.anything(),
"user-1",
expect.any(String),
expect.any(String),
expect.objectContaining({
totalEligibleEvents: 4_200,
includedEvents: 150,
omittedEvents: 4_050,
}),
expect.objectContaining({
returnClaim: true,
items: expect.any(Array),
}),
);
expect(data.createDigestRun.mock.calls[0]?.[5].items).toHaveLength(4_200);
expect(deliverWeeklyDigest).toHaveBeenCalledWith(
expect.anything(),
expect.objectContaining({
items: expect.any(Array),
totalEligibleEvents: 4_200,
includedEvents: 150,
omittedEvents: 4_050,
}),
);
expect(deliverWeeklyDigest.mock.calls[0]?.[1].items).toHaveLength(150);
});

it("keeps provisional items in the digest but excludes them from mixed AI strategy input", async () => {
const data = dataServerMock({
listWatchEventsBetween: vi.fn().mockResolvedValue([weeklyEvent(), provisionalEvent()]),
});
const deliverWeeklyDigest = vi.fn().mockResolvedValue({ attempts: 1, channels: ["email"] });
const aiRun = vi.fn().mockResolvedValue(GOOD_PARAGRAPH);

vi.doMock("~/lib/auth.server", () => ({}));
vi.doMock("~/lib/data.server", () => data);
vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest }));
vi.doMock("~/lib/plan.server", () => planServerMock("starter"));

const { runWeeklyDigests } = await import("~/lib/monitoring.server");
await expect(runWeeklyDigests(envWith(aiRun), { periodEnd: "2026-07-13T05:00:00.000Z" })).resolves.toBe(1);

const request = aiRun.mock.calls[0]?.[1] as {
messages: Array<{ role: string; content: string }>;
};
const userPrompt = request.messages.find((message) => message.role === "user")?.content ?? "";
expect(userPrompt).toContain("Landing page offer changed");
expect(userPrompt).not.toContain("Possible CTA change");

expect(data.createDigestRun).toHaveBeenCalledWith(
expect.anything(),
"user-1",
expect.any(String),
expect.any(String),
expect.objectContaining({
totalEvents: 2,
}),
expect.objectContaining({
items: expect.arrayContaining([
expect.objectContaining({
title: "Landing page offer changed",
metadata: expect.objectContaining({ eventStatus: "confirmed" }),
}),
expect.objectContaining({
title: "Possible CTA change",
metadata: expect.objectContaining({ eventStatus: "proof_pending" }),
}),
]),
}),
);
expect(data.createDigestRun.mock.calls[0]?.[4]).not.toHaveProperty("strategyParagraph");
expect(data.completeDigestStrategyGeneration).toHaveBeenCalledWith(
expect.anything(),
"digest-1",
expect.objectContaining({
summary: expect.objectContaining({
totalEvents: 2,
strategyParagraph: GOOD_PARAGRAPH,
strategyWatchlistIds: ["watch-1"],
}),
}),
);
expect(deliverWeeklyDigest).toHaveBeenCalledWith(
expect.anything(),
expect.objectContaining({
strategyParagraph: GOOD_PARAGRAPH,
items: expect.arrayContaining([
expect.objectContaining({ title: "Landing page offer changed" }),
expect.objectContaining({ title: "Possible CTA change" }),
]),
}),
);
});

it("persists and delivers provisional-only digest items without an AI strategy summary", async () => {
const data = dataServerMock({
listWatchEventsBetween: vi.fn().mockResolvedValue([provisionalEvent()]),
});
const deliverWeeklyDigest = vi.fn().mockResolvedValue({ attempts: 1, channels: ["email"] });
const aiRun = vi.fn().mockResolvedValue(GOOD_PARAGRAPH);

vi.doMock("~/lib/auth.server", () => ({}));
vi.doMock("~/lib/data.server", () => data);
vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest }));
vi.doMock("~/lib/plan.server", () => planServerMock("starter"));

const { runWeeklyDigests } = await import("~/lib/monitoring.server");
await expect(runWeeklyDigests(envWith(aiRun), { periodEnd: "2026-07-13T05:00:00.000Z" })).resolves.toBe(1);

expect(aiRun).not.toHaveBeenCalled();
expect(data.completeDigestStrategyGeneration).toHaveBeenCalledWith(
expect.anything(),
"digest-1",
expect.objectContaining({
summary: expect.objectContaining({ strategyGenerationStatus: "ready" }),
}),
);
expect(data.createDigestRun).toHaveBeenCalledWith(
expect.anything(),
"user-1",
expect.any(String),
expect.any(String),
expect.not.objectContaining({ strategyParagraph: expect.anything() }),
expect.objectContaining({
items: [
expect.objectContaining({
title: "Possible CTA change",
metadata: expect.objectContaining({ eventStatus: "proof_pending" }),
}),
],
}),
);
expect(deliverWeeklyDigest).toHaveBeenCalledWith(
expect.anything(),
expect.objectContaining({
strategyParagraph: null,
items: [expect.objectContaining({ title: "Possible CTA change" })],
}),
);
});

it("skips generation for scout weekly digests without changing delivery", async () => {
const data = dataServerMock();
const deliverWeeklyDigest = vi.fn().mockResolvedValue({ attempts: 1, channels: ["email"] });
const aiRun = vi.fn().mockResolvedValue(GOOD_PARAGRAPH);

vi.doMock("~/lib/auth.server", () => ({}));
vi.doMock("~/lib/data.server", () => data);
vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest }));
vi.doMock("~/lib/plan.server", () => planServerMock("scout"));

const { runWeeklyDigests } = await import("~/lib/monitoring.server");
const result = await runWeeklyDigests(envWith(aiRun), { periodEnd: "2026-07-13T05:00:00.000Z" });

expect(result).toBe(1);
expect(aiRun).not.toHaveBeenCalled();
expect(data.completeDigestStrategyGeneration).not.toHaveBeenCalled();
expect(data.updateDigestRunSummary).not.toHaveBeenCalled();
expect(data.createDigestRun).toHaveBeenCalledWith(
expect.anything(),
"user-1",
expect.any(String),
expect.any(String),
expect.not.objectContaining({ strategyParagraph: expect.anything() }),
expect.objectContaining({
returnClaim: true,
items: [expect.objectContaining({ watchlistId: "watch-1" })],
}),
);
expect(deliverWeeklyDigest).toHaveBeenCalledWith(
expect.anything(),
expect.objectContaining({ strategyParagraph: null }),
);
});

it("skips free-plan users entirely — no digest, no AI call", async () => {
const data = dataServerMock();
const deliverWeeklyDigest = vi.fn();
const aiRun = vi.fn();

vi.doMock("~/lib/auth.server", () => ({}));
vi.doMock("~/lib/data.server", () => data);
vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest }));
vi.doMock("~/lib/plan.server", () => planServerMock("free"));

const { runWeeklyDigests } = await import("~/lib/monitoring.server");
const result = await runWeeklyDigests(envWith(aiRun), { periodEnd: "2026-07-13T05:00:00.000Z" });

expect(result).toBe(0);
expect(aiRun).not.toHaveBeenCalled();
expect(deliverWeeklyDigest).not.toHaveBeenCalled();
expect(data.createDigestRun).not.toHaveBeenCalled();
});

// Digest periods are pinned (weekly → Monday 05:00 UTC, daily → Wednesday 04:00 UTC):
// the Monday daily-digest skip (WP-22) makes unpinned daily runs date-dependent —
// they passed six days a week and failed every Monday in CI.
it("skips generation for agency daily digests — weekly only", async () => {
const data = dataServerMock();
const deliverWeeklyDigest = vi.fn().mockResolvedValue({ attempts: 1, channels: ["email"] });
const aiRun = vi.fn().mockResolvedValue(GOOD_PARAGRAPH);

vi.doMock("~/lib/auth.server", () => ({}));
vi.doMock("~/lib/data.server", () => data);
vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest }));
vi.doMock("~/lib/plan.server", () => planServerMock("agency"));

const { runDailyDigests } = await import("~/lib/monitoring.server");
const result = await runDailyDigests(envWith(aiRun), { periodEnd: "2026-07-15T04:00:00.000Z" });

expect(result).toBe(1);
expect(aiRun).not.toHaveBeenCalled();
expect(deliverWeeklyDigest).toHaveBeenCalledWith(
expect.anything(),
expect.objectContaining({ strategyParagraph: null }),
);
});

it("never blocks delivery when generation fails — the digest ships without a paragraph", async () => {
const data = dataServerMock();
const deliverWeeklyDigest = vi.fn().mockResolvedValue({ attempts: 1, channels: ["email"] });
const aiRun = vi.fn().mockRejectedValue(new Error("Workers AI capacity"));

vi.doMock("~/lib/auth.server", () => ({}));
vi.doMock("~/lib/data.server", () => data);
vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest }));
vi.doMock("~/lib/plan.server", () => planServerMock("starter"));

const { runWeeklyDigests } = await import("~/lib/monitoring.server");
const result = await runWeeklyDigests(envWith(aiRun), { periodEnd: "2026-07-13T05:00:00.000Z" });

expect(result).toBe(1);
expect(aiRun).toHaveBeenCalledTimes(1);
expect(data.updateDigestRunSummary).not.toHaveBeenCalled();
expect(data.completeDigestStrategyGeneration).toHaveBeenCalledWith(
expect.anything(),
"digest-1",
expect.objectContaining({
summary: expect.not.objectContaining({ strategyParagraph: expect.anything() }),
}),
);
expect(deliverWeeklyDigest).toHaveBeenCalledWith(
expect.anything(),
expect.objectContaining({ strategyParagraph: null }),
);
});

it("reuses the stored paragraph for an existing run instead of regenerating", async () => {
const existingDigest = {
id: "digest-existing",
userId: "user-1",
periodStart: "2026-04-13T05:00:00.000Z",
periodEnd: "2026-04-20T05:00:00.000Z",
summary: {
totalEvents: 1,
totalEligibleEvents: 1,
includedEvents: 1,
omittedEvents: 0,
watchlists: 1,
digestItemSetProvenance: "atomic-v2",
strategyParagraph: STORED_PARAGRAPH,
strategyGeneratedAt: "2026-04-20T05:01:00.000Z",
},
createdAt: "2026-04-20T05:01:00.000Z",
items: [
{
id: "digest-item-1",
digestRunId: "digest-existing",
watchlistId: "watch-1",
watchlistName: "boAt watch",
eventType: "landing_page_offer_changed",
title: "Stored offer change",
summary: "The original digest item.",
metadata: { eventId: "event-stored-1" },
createdAt: "2026-04-20T05:01:00.000Z",
},
],
delivery: {
id: "delivery-1",
digestRunId: "digest-existing",
provider: "cloudflare_email",
status: "failed",
recipientEmail: "owner@example.com",
externalMessageId: null,
errorMessage: "timeout",
deliveredAt: null,
},
};
const data = dataServerMock({
getDigestByPeriod: vi.fn().mockResolvedValue(existingDigest),
});
const deliverWeeklyDigest = vi.fn().mockResolvedValue({ attempts: 1, channels: ["email"] });
const aiRun = vi.fn().mockResolvedValue(GOOD_PARAGRAPH);

vi.doMock("~/lib/auth.server", () => ({}));
vi.doMock("~/lib/data.server", () => data);
vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest }));
vi.doMock("~/lib/plan.server", () => planServerMock("starter"));

const { runWeeklyDigests } = await import("~/lib/monitoring.server");
await runWeeklyDigests(envWith(aiRun), { periodEnd: "2026-07-13T05:00:00.000Z" });

expect(aiRun).not.toHaveBeenCalled();
expect(data.createDigestRun).not.toHaveBeenCalled();
expect(data.updateDigestRunSummary).not.toHaveBeenCalled();
expect(deliverWeeklyDigest).toHaveBeenCalledWith(
expect.anything(),
expect.objectContaining({
digestRunId: "digest-existing",
strategyParagraph: STORED_PARAGRAPH,
}),
);
});

it("fails closed on a partial legacy run even when today's candidate count matches", async () => {
const secondEvent = {
...weeklyEvent(),
id: "event-2",
eventType: "landing_page_cta_changed",
title: "Landing page CTA changed",
summary: "CTA changed on the landing page.",
};
const partialDigest = {
id: "digest-partial",
userId: "user-1",
periodStart: "2026-07-06T05:00:00.000Z",
periodEnd: "2026-07-13T05:00:00.000Z",
summary: {
totalEvents: 2,
watchlists: 1,
strategyParagraph: STORED_PARAGRAPH,
strategyGeneratedAt: "2026-07-13T05:01:00.000Z",
},
createdAt: "2026-07-13T05:01:00.000Z",
items: [
{
id: "digest-item-1",
digestRunId: "digest-partial",
watchlistId: "watch-1",
watchlistName: "boAt watch",
eventType: "landing_page_offer_changed",
title: "Only the first item survived",
summary: "The legacy worker stopped before item two.",
metadata: {},
createdAt: "2026-07-13T05:01:00.000Z",
},
],
delivery: null,
};
const data = dataServerMock({
getDigestByPeriod: vi.fn().mockResolvedValue(partialDigest),
listWatchEventsBetween: vi.fn().mockResolvedValue([weeklyEvent(), secondEvent]),
});
const deliverWeeklyDigest = vi.fn();
const aiRun = vi.fn().mockResolvedValue(GOOD_PARAGRAPH);
vi.spyOn(console, "error").mockImplementation(() => undefined);

vi.doMock("~/lib/auth.server", () => ({}));
vi.doMock("~/lib/data.server", () => data);
vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest }));
vi.doMock("~/lib/plan.server", () => planServerMock("starter"));

const { runWeeklyDigests } = await import("~/lib/monitoring.server");
await expect(runWeeklyDigests(envWith(aiRun), { periodEnd: "2026-07-13T05:00:00.000Z" })).resolves.toBe(0);

expect(aiRun).not.toHaveBeenCalled();
expect(data.createDigestRun).not.toHaveBeenCalled();
expect(data.updateDigestRunSummary).not.toHaveBeenCalled();
expect(deliverWeeklyDigest).not.toHaveBeenCalled();
});

it("fails closed on an unmarked legacy run even when its stored item count matches", async () => {
const data = dataServerMock({
getDigestByPeriod: vi.fn().mockResolvedValue({
id: "digest-unmarked-same-count",
userId: "user-1",
periodStart: "2026-07-06T05:00:00.000Z",
periodEnd: "2026-07-13T05:00:00.000Z",
summary: { totalEvents: 1, watchlists: 1 },
createdAt: "2026-07-13T05:01:00.000Z",
items: [{
id: "item-unmarked",
digestRunId: "digest-unmarked-same-count",
watchlistId: "watch-1",
watchlistName: "boAt watch",
eventType: "landing_page_offer_changed",
title: "Unproven legacy item",
summary: "A matching count does not prove snapshot identity.",
metadata: {},
createdAt: "2026-07-13T05:01:00.000Z",
}],
delivery: null,
}),
});
const deliverWeeklyDigest = vi.fn();
vi.spyOn(console, "error").mockImplementation(() => undefined);

vi.doMock("~/lib/auth.server", () => ({}));
vi.doMock("~/lib/data.server", () => data);
vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest }));
vi.doMock("~/lib/plan.server", () => planServerMock("starter"));

const { runWeeklyDigests } = await import("~/lib/monitoring.server");
await expect(runWeeklyDigests(envWith(null), { periodEnd: "2026-07-13T05:00:00.000Z" })).resolves.toBe(0);
expect(deliverWeeklyDigest).not.toHaveBeenCalled();
});

it("delivers a marked zero-item heartbeat snapshot", async () => {
const data = dataServerMock({
getDigestByPeriod: vi.fn().mockResolvedValue({
id: "digest-marked-heartbeat",
userId: "user-1",
periodStart: "2026-07-06T05:00:00.000Z",
periodEnd: "2026-07-13T05:00:00.000Z",
summary: {
totalEvents: 0,
totalEligibleEvents: 0,
includedEvents: 0,
omittedEvents: 0,
watchlists: 1,
digestItemSetProvenance: "atomic-v2",
},
createdAt: "2026-07-13T05:01:00.000Z",
items: [],
delivery: null,
}),
getSuccessfulRunStatsForUserBetween: vi.fn().mockResolvedValue({
runs: 2,
watchlistsChecked: 1,
adsSeen: 14,
}),
});
const deliverWeeklyDigest = vi.fn().mockResolvedValue({ attempts: 1, channels: ["email"] });

vi.doMock("~/lib/auth.server", () => ({}));
vi.doMock("~/lib/data.server", () => data);
vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest }));
vi.doMock("~/lib/plan.server", () => planServerMock("starter"));

const { runWeeklyDigests } = await import("~/lib/monitoring.server");
await expect(runWeeklyDigests(envWith(null), { periodEnd: "2026-07-13T05:00:00.000Z" })).resolves.toBe(1);
expect(deliverWeeklyDigest).toHaveBeenCalledWith(
expect.anything(),
expect.objectContaining({
digestRunId: "digest-marked-heartbeat",
items: [],
heartbeat: { runs: 2, watchlistsChecked: 1, adsSeen: 14 },
}),
);
});

it("fails closed when an incomplete legacy run has a different current candidate count", async () => {
const data = dataServerMock({
getDigestByPeriod: vi.fn().mockResolvedValue({
id: "digest-unreconstructable",
userId: "user-1",
periodStart: "2026-07-06T05:00:00.000Z",
periodEnd: "2026-07-13T05:00:00.000Z",
summary: { totalEvents: 2, watchlists: 1 },
createdAt: "2026-07-13T05:01:00.000Z",
items: [],
delivery: null,
}),
});
const deliverWeeklyDigest = vi.fn();
const aiRun = vi.fn();
vi.spyOn(console, "error").mockImplementation(() => undefined);

vi.doMock("~/lib/auth.server", () => ({}));
vi.doMock("~/lib/data.server", () => data);
vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest }));
vi.doMock("~/lib/plan.server", () => planServerMock("starter"));

const { runWeeklyDigests } = await import("~/lib/monitoring.server");
await expect(runWeeklyDigests(envWith(aiRun), { periodEnd: "2026-07-13T05:00:00.000Z" })).resolves.toBe(0);

expect(deliverWeeklyDigest).not.toHaveBeenCalled();
});

});
