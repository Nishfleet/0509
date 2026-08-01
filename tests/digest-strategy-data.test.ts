import { describe, expect, it } from "vitest";

import {
createDigestRun,
getDigest,
getLatestDigestRunSummaryForWatchlist,
listDigests,
updateDigestRunSummary,
upsertDigestDelivery,
} from "~/lib/data.server";

import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

const PARAGRAPH =
"Nykaa refreshed its landing page discount while boAt introduced new festival-focused ads across the watched accounts this week.";

function setup() {
const harness = createSqliteD1();
applyMigration(harness.sqlite, "migrations/0000_auth.sql");
applyMigration(harness.sqlite, "migrations/0001_app.sql");
applyMigration(harness.sqlite, "migrations/0002_monitoring_trust.sql");
harness.sqlite
.prepare(
"INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)",
)
.run("user-1", "Owner", "owner@example.com", "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
harness.sqlite
.prepare(
`INSERT INTO watchlist (
        id, user_id, name, target_type, target_id, target_fingerprint,
        target_label, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, 'advertiser', ?, ?, ?, 1, ?, ?)`,
)
.run(
"watch-1",
"user-1",
"boAt watch",
"target-1",
"fingerprint-1",
"boAt",
"2026-07-01T00:00:00.000Z",
"2026-07-01T00:00:00.000Z",
);
return harness;
}

describe("digest_run summary persistence", () => {
it("reports which overlapping create actually claimed the period", async () => {
const harness = setup();
try {
const env = { DB: harness.db } as never;
const first = await createDigestRun(
env,
"user-1",
"2026-07-06T05:00:00.000Z",
"2026-07-13T05:00:00.000Z",
{ strategyParagraph: `${PARAGRAPH} first` },
{
returnClaim: true,
items: [{
watchlistId: "watch-1",
watchlistName: "First winner",
eventType: "landing_page_offer_changed",
title: "First item",
summary: "The winner's item.",
}],
},
);
const second = await createDigestRun(
env,
"user-1",
"2026-07-06T05:00:00.000Z",
"2026-07-13T05:00:00.000Z",
{ strategyParagraph: `${PARAGRAPH} second` },
{
returnClaim: true,
items: [{
watchlistId: "watch-1",
watchlistName: "Losing candidate",
eventType: "landing_page_cta_changed",
title: "Losing item",
summary: "This item must never be persisted.",
}],
},
);

expect(first).toMatchObject({ created: true, digestRunId: expect.any(String) });
expect(second).toEqual({ created: false, digestRunId: first.digestRunId });
const stored = await getDigest(env, first.digestRunId);
expect(stored?.summary).toMatchObject({
digestItemSetProvenance: "atomic-v2",
strategyParagraph: `${PARAGRAPH} first`,
});
expect(stored?.items).toEqual([
expect.objectContaining({ title: "First item", summary: "The winner's item." }),
]);
expect(
harness.sqlite.prepare("SELECT COUNT(*) AS count FROM digest_run").get(),
).toEqual({ count: 1 });
expect(
harness.sqlite.prepare("SELECT COUNT(*) AS count FROM digest_item").get(),
).toEqual({ count: 1 });
} finally {
harness.close();
}
});

it("commits the atomic marker and complete items together or neither", async () => {
const harness = setup();
try {
const env = { DB: harness.db } as never;
await expect(
createDigestRun(
env,
"user-1",
"2026-07-06T05:00:00.000Z",
"2026-07-13T05:00:00.000Z",
{ totalEvents: 1, watchlists: 1 },
{
returnClaim: true,
items: [{
watchlistId: "watch-missing",
watchlistName: "Missing watchlist",
eventType: "landing_page_offer_changed",
title: "Atomic item",
summary: "This item should roll the run back with it.",
}],
},
),
).rejects.toThrow();

expect(
harness.sqlite.prepare("SELECT COUNT(*) AS count FROM digest_run").get(),
).toEqual({ count: 0 });
expect(
harness.sqlite.prepare("SELECT COUNT(*) AS count FROM digest_item").get(),
).toEqual({ count: 0 });
} finally {
harness.close();
}
});

it("never downgrades a sent digest delivery during a later retry write", async () => {
const harness = setup();
try {
const env = { DB: harness.db } as never;
const digestRunId = await createDigestRun(
env,
"user-1",
"2026-07-06T05:00:00.000Z",
"2026-07-13T05:00:00.000Z",
{ totalEvents: 0, watchlists: 1 },
);
await upsertDigestDelivery(env, digestRunId, {
provider: "cloudflare_email",
status: "sent",
recipientEmail: "owner@example.com",
externalMessageId: "message-sent",
errorMessage: null,
deliveredAt: "2026-07-13T05:02:00.000Z",
});
await upsertDigestDelivery(env, digestRunId, {
provider: "whatsapp_cloud_api",
status: "pending",
recipientEmail: "+919999999999",
externalMessageId: null,
errorMessage: "A later worker still had an older pending result.",
deliveredAt: null,
});

expect((await getDigest(env, digestRunId))?.delivery).toMatchObject({
provider: "cloudflare_email",
status: "sent",
recipientEmail: "owner@example.com",
externalMessageId: "message-sent",
errorMessage: null,
deliveredAt: "2026-07-13T05:02:00.000Z",
});
} finally {
harness.close();
}
});

it("does not let acceptance-only sent state clear a confirmed delivery", async () => {
const harness = setup();
try {
const env = { DB: harness.db } as never;
const digestRunId = await createDigestRun(
env,
"user-1",
"2026-07-06T05:00:00.000Z",
"2026-07-13T05:00:00.000Z",
{ totalEvents: 0, watchlists: 1 },
);
await upsertDigestDelivery(env, digestRunId, {
provider: "cloudflare_email",
status: "sent",
recipientEmail: "confirmed@example.com",
externalMessageId: "message-delivered",
errorMessage: null,
deliveredAt: "2026-07-13T05:02:00.000Z",
});
await upsertDigestDelivery(env, digestRunId, {
provider: "cloudflare_email",
status: "sent",
recipientEmail: "accepted-only@example.com",
externalMessageId: "message-accepted",
errorMessage: null,
deliveredAt: null,
});

expect((await getDigest(env, digestRunId))?.delivery).toMatchObject({
provider: "cloudflare_email",
status: "sent",
recipientEmail: "confirmed@example.com",
externalMessageId: "message-delivered",
errorMessage: null,
deliveredAt: "2026-07-13T05:02:00.000Z",
});
} finally {
harness.close();
}
});

it("does not let older confirmed delivery displace newer receipt evidence", async () => {
const harness = setup();
try {
const env = { DB: harness.db } as never;
const digestRunId = await createDigestRun(
env,
"user-1",
"2026-07-06T05:00:00.000Z",
"2026-07-13T05:00:00.000Z",
{ totalEvents: 0, watchlists: 1 },
);
await upsertDigestDelivery(env, digestRunId, {
provider: "cloudflare_email",
status: "sent",
recipientEmail: "newer@example.com",
externalMessageId: "message-newer",
errorMessage: null,
deliveredAt: "2026-07-13T05:20:00.000Z",
});
await upsertDigestDelivery(env, digestRunId, {
provider: "cloudflare_email",
status: "sent",
recipientEmail: "older@example.com",
externalMessageId: "message-older",
errorMessage: null,
deliveredAt: "2026-07-13T05:10:00.000Z",
});

expect((await getDigest(env, digestRunId))?.delivery).toMatchObject({
recipientEmail: "newer@example.com",
externalMessageId: "message-newer",
deliveredAt: "2026-07-13T05:20:00.000Z",
});

await upsertDigestDelivery(env, digestRunId, {
provider: "cloudflare_email",
status: "sent",
recipientEmail: "latest@example.com",
externalMessageId: "message-latest",
errorMessage: null,
deliveredAt: "2026-07-13T05:30:00.000Z",
});
expect((await getDigest(env, digestRunId))?.delivery).toMatchObject({
recipientEmail: "latest@example.com",
externalMessageId: "message-latest",
deliveredAt: "2026-07-13T05:30:00.000Z",
});
} finally {
harness.close();
}
});

it("never buries a failed digest delivery under an overlapping writer's pending mirror", async () => {
// Duplicate cron fire: writer X records the failure; the losing writer Y
// observed X's in-flight pending attempt and mirrors it afterwards. The
// aggregate must stay 'failed' or the run drops out of the retry sweep
// forever. A terminal write (sent/failed) still overwrites 'failed'.
const harness = setup();
try {
const env = { DB: harness.db } as never;
const digestRunId = await createDigestRun(
env,
"user-1",
"2026-07-06T05:00:00.000Z",
"2026-07-13T05:00:00.000Z",
{ totalEvents: 0, watchlists: 1 },
);
await upsertDigestDelivery(env, digestRunId, {
provider: "cloudflare_email",
status: "failed",
recipientEmail: "owner@example.com",
externalMessageId: null,
errorMessage: "Cloudflare Email send failed: rejected.",
deliveredAt: null,
});
await upsertDigestDelivery(env, digestRunId, {
provider: "cloudflare_email",
status: "pending",
recipientEmail: "owner@example.com",
externalMessageId: null,
errorMessage: null,
deliveredAt: null,
});

expect((await getDigest(env, digestRunId))?.delivery).toMatchObject({
status: "failed",
errorMessage: "Cloudflare Email send failed: rejected.",
});

// The claim-winning retry's terminal outcome still lands.
await upsertDigestDelivery(env, digestRunId, {
provider: "cloudflare_email",
status: "sent",
recipientEmail: "owner@example.com",
externalMessageId: "message-retry",
errorMessage: null,
deliveredAt: "2026-07-13T05:10:00.000Z",
});
expect((await getDigest(env, digestRunId))?.delivery).toMatchObject({
status: "sent",
externalMessageId: "message-retry",
});
} finally {
harness.close();
}
});

it("lets a claim-winning retry move a failed aggregate back to pending", async () => {
// A claim-WINNING retry may honestly move failed → pending (e.g. its
// provider call ended provider-unknown): without this escape hatch the
// aggregate would stay 'failed' forever while the attempt row is
// terminal, pinning the run in the retry sweep and mislabeling an
// unknown outcome as a failure in /app/digests.
const harness = setup();
try {
const env = { DB: harness.db } as never;
const digestRunId = await createDigestRun(
env,
"user-1",
"2026-07-06T05:00:00.000Z",
"2026-07-13T05:00:00.000Z",
{ totalEvents: 0, watchlists: 1 },
);
await upsertDigestDelivery(env, digestRunId, {
provider: "cloudflare_email",
status: "failed",
recipientEmail: "owner@example.com",
externalMessageId: null,
errorMessage: "Cloudflare Email send failed: rejected.",
deliveredAt: null,
});
await upsertDigestDelivery(env, digestRunId, {
provider: "cloudflare_email",
status: "pending",
recipientEmail: "owner@example.com",
externalMessageId: null,
errorMessage: "Cloudflare Email send outcome is unknown after provider timeout.",
deliveredAt: null,
allowPendingOverwriteOfFailed: true,
});

expect((await getDigest(env, digestRunId))?.delivery).toMatchObject({
status: "pending",
errorMessage: "Cloudflare Email send outcome is unknown after provider timeout.",
});
} finally {
harness.close();
}
});

it("stores the strategy summary on create and reads it back via getDigest and listDigests", async () => {
const harness = setup();
try {
const env = { DB: harness.db } as never;
const digestRunId = await createDigestRun(
env,
"user-1",
"2026-07-06T05:00:00.000Z",
"2026-07-13T05:00:00.000Z",
{
totalEvents: 2,
watchlists: 1,
strategyParagraph: PARAGRAPH,
strategyModel: "@cf/meta/llama-3.2-3b-instruct",
strategyGeneratedAt: "2026-07-13T05:01:00.000Z",
strategyWatchlistIds: ["watch-1"],
},
);

const digest = await getDigest(env, digestRunId);
expect(digest?.summary).toMatchObject({
totalEvents: 2,
strategyParagraph: PARAGRAPH,
strategyGeneratedAt: "2026-07-13T05:01:00.000Z",
strategyWatchlistIds: ["watch-1"],
});

const listed = await listDigests(env, "user-1");
expect(listed).toHaveLength(1);
expect(listed[0]?.summary).toMatchObject({ strategyParagraph: PARAGRAPH });
} finally {
harness.close();
}
});

it("allows an explicit recovery path to replace an existing summary", async () => {
const harness = setup();
try {
const env = { DB: harness.db } as never;
const firstClaim = await createDigestRun(
env,
"user-1",
"2026-07-06T05:00:00.000Z",
"2026-07-13T05:00:00.000Z",
{ totalEvents: 0, watchlists: 1 },
{ returnClaim: true, items: [] },
);
const firstId = firstClaim.digestRunId;

// Same period again: the period claim keeps the original summary.
const secondId = await createDigestRun(
env,
"user-1",
"2026-07-06T05:00:00.000Z",
"2026-07-13T05:00:00.000Z",
{ totalEvents: 2, strategyParagraph: PARAGRAPH },
);
expect(secondId).toBe(firstId);
expect((await getDigest(env, firstId))?.summary).toEqual({
totalEvents: 0,
watchlists: 1,
totalEligibleEvents: 0,
includedEvents: 0,
omittedEvents: 0,
digestItemSetProvenance: "atomic-v2",
});

await updateDigestRunSummary(env, firstId, {
totalEvents: 2,
strategyParagraph: PARAGRAPH,
strategyGeneratedAt: "2026-07-13T05:01:00.000Z",
});
expect((await getDigest(env, firstId))?.summary).toMatchObject({
digestItemSetProvenance: "atomic-v2",
strategyParagraph: PARAGRAPH,
});
} finally {
harness.close();
}
});

it("tolerates legacy summary shapes without breaking reads", async () => {
const harness = setup();
try {
const env = { DB: harness.db } as never;
const insert = harness.sqlite.prepare(
"INSERT INTO digest_run (id, user_id, period_start, period_end, summary_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
);
insert.run(
"digest-legacy-invalid",
"user-1",
"2026-06-22T05:00:00.000Z",
"2026-06-29T05:00:00.000Z",
"not-json{",
"2026-06-29T05:01:00.000Z",
);
insert.run(
"digest-legacy-array",
"user-1",
"2026-06-29T05:00:00.000Z",
"2026-07-06T05:00:00.000Z",
"[1,2,3]",
"2026-07-06T05:01:00.000Z",
);

expect((await getDigest(env, "digest-legacy-invalid"))?.summary).toEqual({});
expect((await getDigest(env, "digest-legacy-array"))?.summary).toEqual({});
await expect(
getLatestDigestRunSummaryForWatchlist(env, "user-1", "watch-1"),
).resolves.toBeNull();
} finally {
harness.close();
}
});

it("returns only a paragraph proven to belong exclusively to the report watchlist", async () => {
const harness = setup();
try {
const env = { DB: harness.db } as never;
await createDigestRun(env, "user-1", "2026-06-29T05:00:00.000Z", "2026-07-06T05:00:00.000Z", {
totalEvents: 1,
strategyParagraph: `${PARAGRAPH} (older week)`,
strategyGeneratedAt: "2026-07-06T05:01:00.000Z",
strategyWatchlistIds: ["watch-1"],
});
// Newer weekly run with a paragraph.
await createDigestRun(env, "user-1", "2026-07-06T05:00:00.000Z", "2026-07-13T05:00:00.000Z", {
totalEvents: 2,
strategyParagraph: PARAGRAPH,
strategyGeneratedAt: "2026-07-13T05:01:00.000Z",
strategyWatchlistIds: ["watch-1"],
});
// 24 later unrelated/invalid runs must not hide watch-1's retained strategy.
for (let offset = 0; offset < 24; offset += 1) {
const periodStart = new Date(Date.UTC(2026, 6, 13 + offset, 5)).toISOString();
const periodEnd = new Date(Date.UTC(2026, 6, 14 + offset, 5)).toISOString();
await createDigestRun(env, "user-1", periodStart, periodEnd, offset >= 12
? { strategyParagraph: "\u00a0\u2007\u202f", strategyGeneratedAt: periodEnd, strategyWatchlistIds: ["watch-1"] }
: offset % 2 === 0 ? { totalEvents: 0, watchlists: 1 } : {
strategyParagraph: `${PARAGRAPH} (other watchlist)`,
strategyGeneratedAt: periodEnd,
strategyWatchlistIds: ["watch-2"],
});
}

await expect(
getLatestDigestRunSummaryForWatchlist(env, "user-1", "watch-1"),
).resolves.toEqual({
paragraph: PARAGRAPH,
generatedAt: "2026-07-13T05:01:00.000Z",
periodEnd: "2026-07-13T05:00:00.000Z",
});

// Another user's runs never leak in.
await expect(
getLatestDigestRunSummaryForWatchlist(env, "user-2", "watch-1"),
).resolves.toBeNull();
} finally {
harness.close();
}
});

it("fails closed for legacy, mismatched, and mixed-watchlist provenance", async () => {
const harness = setup();
try {
const env = { DB: harness.db } as never;
await createDigestRun(env, "user-1", "2026-06-15T05:00:00.000Z", "2026-06-22T05:00:00.000Z", {
strategyParagraph: PARAGRAPH,
strategyGeneratedAt: "2026-06-22T05:01:00.000Z",
});
await createDigestRun(env, "user-1", "2026-06-22T05:00:00.000Z", "2026-06-29T05:00:00.000Z", {
strategyParagraph: PARAGRAPH,
strategyGeneratedAt: "2026-06-29T05:01:00.000Z",
strategyWatchlistIds: ["watch-2"],
});
await createDigestRun(env, "user-1", "2026-06-29T05:00:00.000Z", "2026-07-06T05:00:00.000Z", {
strategyParagraph: PARAGRAPH,
strategyGeneratedAt: "2026-07-06T05:01:00.000Z",
strategyWatchlistIds: ["watch-1", "watch-2"],
});

await expect(
getLatestDigestRunSummaryForWatchlist(env, "user-1", "watch-1"),
).resolves.toBeNull();
} finally {
harness.close();
}
});
});
