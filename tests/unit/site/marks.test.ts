import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { PageDiff } from "../../../app/lib/site/diff";
import { extractPageText } from "../../../app/lib/site/extract-text";
import {
  buildStoredDiff,
  diffHunksKey,
  r2SiteArtifacts,
  screenshotKey,
  snapshotTextKey,
} from "../../../app/lib/site/marks";
import copyAfter from "../../fixtures/copy-change-after.html?raw";
import copyBefore from "../../fixtures/copy-change-before.html?raw";

describe("site R2 keys", () => {
  it("keys are scoped by tenant, entity, page and instant", () => {
    const opts = {
      workspaceId: "ws1",
      entityId: "e1",
      pageId: "p1",
      fetchedAt: "2026-09-23T00:00:00Z",
    };

    expect(snapshotTextKey(opts)).toBe("site/text/ws1/e1/p1/2026-09-23T00:00:00Z.txt");
    expect(screenshotKey({ ...opts, when: "2026-09-23", side: "before" })).toBe(
      "site/screens/ws1/e1/p1/2026-09-23-before.png",
    );
    expect(diffHunksKey(opts)).toBe("site/diffs/ws1/e1/p1/2026-09-23T00:00:00Z.json");
  });

  it("never places a site artifact in the card/ prefix", () => {
    const opts = {
      workspaceId: "ws1",
      entityId: "e1",
      pageId: "p1",
      fetchedAt: "2026-09-23T00:00:00Z",
    };

    expect(snapshotTextKey(opts)).not.toContain("card/");
    expect(snapshotTextKey(opts)).toContain("site/");
  });
});

describe("buildStoredDiff", () => {
  it("references the hunk body and both screenshots by key, never inline", () => {
    const stored = buildStoredDiff({
      workspaceId: "ws1",
      entityId: "e1",
      pageId: "p1",
      fetchedAt: "2026-09-23T00:00:00Z",
      screenshot: {
        before: "site/screens/ws1/e1/p1/before.png",
        after: "site/screens/ws1/e1/p1/after.png",
      },
    });

    expect(stored).toEqual({
      diffR2Key: "site/diffs/ws1/e1/p1/2026-09-23T00:00:00Z.json",
      screenshotR2Keys: {
        before: "site/screens/ws1/e1/p1/before.png",
        after: "site/screens/ws1/e1/p1/after.png",
      },
      capturedAt: "2026-09-23T00:00:00Z",
    });
  });
});

describe("r2SiteArtifacts", () => {
  const artifacts = r2SiteArtifacts(env.SITE_ARTIFACTS);

  it("round-trips an extracted text through R2 by key", async () => {
    const page = await extractPageText(copyBefore);
    const key = snapshotTextKey({
      workspaceId: "ws-marks",
      entityId: "e1",
      pageId: "p1",
      fetchedAt: "2026-09-23T06:00:00.000Z",
    });

    await artifacts.putText(key, page.text, "2026-09-23T06:00:00.000Z");

    expect(await artifacts.getText(key)).toBe(page.text);
    const object = await env.SITE_ARTIFACTS.get(key);
    expect(object?.customMetadata?.captured_at).toBe("2026-09-23T06:00:00.000Z");
  });

  it("round-trips a diff hunk body keyed by the diff instant", async () => {
    const before = await extractPageText(copyBefore);
    const after = await extractPageText(copyAfter);
    const diff: PageDiff = {
      hunks: [{ before: "Summer", after: "Winter", atWord: 1 }],
      addedWords: 1,
      removedWords: 1,
    };
    const key = diffHunksKey({
      workspaceId: "ws-marks",
      entityId: "e1",
      pageId: "p1",
      fetchedAt: "2026-09-23T06:00:01.000Z",
    });

    await artifacts.putDiffHunks(key, diff, "2026-09-23T06:00:01.000Z");

    expect(await artifacts.getDiffHunks(key)).toEqual(diff);
    const raw = await (await env.SITE_ARTIFACTS.get(key))?.text();
    expect(raw).not.toContain("base64");
    expect(after.text).not.toBe(before.text);
  });

  it("returns null for a missing key rather than throwing", async () => {
    expect(await artifacts.getText("site/text/ws-marks/e1/p1/missing.txt")).toBeNull();
    expect(await artifacts.getDiffHunks("site/diffs/ws-marks/e1/p1/missing.json")).toBeNull();
  });
});
