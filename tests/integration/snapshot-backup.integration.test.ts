import { env, introspectWorkflowInstance } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readFixtureWatchIds } from "../../app/lib/data/watch.server";
import { copyMissingPage } from "../../app/lib/snapshot-backup.server";
import { resetWorld, seedPair, seedSiteWatches } from "./fixture-sweeps/seed";

const seed = async () => {
  await env.SNAPSHOTS.put("snapshot/site/watch-1/1.txt", "a");
  await env.SNAPSHOTS.put("snapshot/site/watch-1/1.png", "b");
  await env.SNAPSHOTS.put("card/ws-1/share.png", "c");
};

describe("nightly snapshot backup", () => {
  beforeEach(async () => {
    await resetWorld();
    for (const bucket of [env.SNAPSHOTS, env.SNAPSHOTS_BACKUP]) {
      const listed = await bucket.list();
      await Promise.all(listed.objects.map((object) => bucket.delete(object.key)));
    }
  });

  it("copies every object the backup bucket does not hold", async () => {
    await seed();

    const id = "snapshot-backup-test";
    await using introspector = await introspectWorkflowInstance(env.SNAPSHOT_BACKUP, id);
    await env.SNAPSHOT_BACKUP.create({ id });
    await introspector.waitForStatus("complete");

    expect(await introspector.getOutput()).toEqual({ listed: 3, copied: 3, present: 0, skipped: 0 });
    const backedUp = await env.SNAPSHOTS_BACKUP.list();
    expect(backedUp.objects.map((object) => object.key).sort()).toEqual([
      "card/ws-1/share.png",
      "snapshot/site/watch-1/1.png",
      "snapshot/site/watch-1/1.txt",
    ]);
  });

  it("copies nothing a second time", async () => {
    await seed();

    const first = "snapshot-backup-first";
    await using firstIntrospector = await introspectWorkflowInstance(env.SNAPSHOT_BACKUP, first);
    await env.SNAPSHOT_BACKUP.create({ id: first });
    await firstIntrospector.waitForStatus("complete");

    const second = "snapshot-backup-second";
    await using secondIntrospector = await introspectWorkflowInstance(env.SNAPSHOT_BACKUP, second);
    await env.SNAPSHOT_BACKUP.create({ id: second });
    await secondIntrospector.waitForStatus("complete");

    expect(await secondIntrospector.getOutput()).toEqual({ listed: 3, copied: 0, present: 3, skipped: 0 });
  });

  it("copies again an object whose backup is a different size from the source", async () => {
    await env.SNAPSHOTS.put("logo/example.png", "fresh logo bytes");
    await env.SNAPSHOTS_BACKUP.put("logo/example.png", "old");

    const page = await copyMissingPage();

    expect(page).toMatchObject({ listed: 1, copied: 1, present: 0 });
    expect(await (await env.SNAPSHOTS_BACKUP.get("logo/example.png"))?.text()).toBe("fresh logo bytes");
  });

  it("preserves the content type of a copied object", async () => {
    await env.SNAPSHOTS.put("snapshot/site/watch-1/1.png", "a", {
      httpMetadata: { contentType: "image/png" },
    });

    const id = "snapshot-backup-content-type";
    await using introspector = await introspectWorkflowInstance(env.SNAPSHOT_BACKUP, id);
    await env.SNAPSHOT_BACKUP.create({ id });
    await introspector.waitForStatus("complete");

    const copied = await env.SNAPSHOTS_BACKUP.head("snapshot/site/watch-1/1.png");
    expect(copied?.httpMetadata?.contentType).toBe("image/png");
  });

  it("reports an empty source", async () => {
    const id = "snapshot-backup-empty";
    await using introspector = await introspectWorkflowInstance(env.SNAPSHOT_BACKUP, id);
    await env.SNAPSHOT_BACKUP.create({ id });
    await introspector.waitForStatus("complete");

    expect(await introspector.getOutput()).toEqual({ listed: 0, copied: 0, present: 0, skipped: 0 });
  });

  it("removes a copy whose source was deleted while the copy was running", async () => {
    await env.SNAPSHOTS.put("snapshot/site/watch-gone/1.txt", "a");
    const put = env.SNAPSHOTS_BACKUP.put.bind(env.SNAPSHOTS_BACKUP);
    const spy = vi.spyOn(env.SNAPSHOTS_BACKUP, "put").mockImplementation(async (key, value, options) => {
      const stored = await put(key, value, options);
      await env.SNAPSHOTS.delete(key);
      return stored;
    });

    const page = await copyMissingPage();
    spy.mockRestore();

    expect(page).toMatchObject({ listed: 1, copied: 0 });
    expect((await env.SNAPSHOTS_BACKUP.list()).objects).toEqual([]);
  });

  it("does not back up the objects of a fixture workspace's watches", async () => {
    const pair = await seedPair();
    const live = await seedSiteWatches(pair.live);
    const fixture = await seedSiteWatches(pair.fixture);
    const liveWatch = live.rivalWatchId;
    const fixtureWatch = fixture.rivalWatchId;
    await env.SNAPSHOTS.put(`snapshot/site/${liveWatch}/1.txt`, "live");
    await env.SNAPSHOTS.put(`snapshot/hiring/${fixtureWatch}/1.json`, "fixture hiring");
    await env.SNAPSHOTS.put(`snapshot/feed/${fixtureWatch}/1.json`, "fixture feed");
    await env.SNAPSHOTS.put(`snapshot/site/${fixtureWatch}/1.txt`, "fixture site");
    await env.SNAPSHOTS.put("snapshot/site/watch-deleted/1.txt", "orphan");
    await env.SNAPSHOTS.put("logo/v3/example.com", "logo");

    const fixtureWatchIds = await readFixtureWatchIds();
    const page = await copyMissingPage(undefined, fixtureWatchIds);

    expect(fixtureWatchIds).toEqual([fixture.selfWatchId, fixture.rivalWatchId].sort());
    expect(page).toMatchObject({ listed: 6, copied: 3, present: 0, skipped: 3 });
    const backedUp = await env.SNAPSHOTS_BACKUP.list();
    expect(backedUp.objects.map((object) => object.key).sort()).toEqual([
      "logo/v3/example.com",
      "snapshot/site/watch-deleted/1.txt",
      `snapshot/site/${liveWatch}/1.txt`,
    ]);
  });

  it("skips a fixture workspace's objects in the nightly workflow too", async () => {
    const pair = await seedPair();
    const fixture = await seedSiteWatches(pair.fixture);
    await env.SNAPSHOTS.put(`snapshot/site/${fixture.rivalWatchId}/1.txt`, "fixture site");
    await env.SNAPSHOTS.put("snapshot/site/watch-deleted/1.txt", "orphan");

    const id = "snapshot-backup-fixture";
    await using introspector = await introspectWorkflowInstance(env.SNAPSHOT_BACKUP, id);
    await env.SNAPSHOT_BACKUP.create({ id });
    await introspector.waitForStatus("complete");

    expect(await introspector.getOutput()).toEqual({ listed: 2, copied: 1, present: 0, skipped: 1 });
  });
});
