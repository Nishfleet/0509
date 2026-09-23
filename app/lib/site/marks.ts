import { z } from "zod";

import type { PageDiff } from "./diff";

export interface StoredDiff {
  diffR2Key: string;
  screenshotR2Keys: { before: string; after: string };
  capturedAt: string;
}

const SITE_PREFIX = "site";

export function snapshotTextKey(opts: {
  workspaceId: string;
  entityId: string;
  pageId: string;
  fetchedAt: string;
}): string {
  return `${SITE_PREFIX}/text/${opts.workspaceId}/${opts.entityId}/${opts.pageId}/${opts.fetchedAt}.txt`;
}

export function screenshotKey(opts: {
  workspaceId: string;
  entityId: string;
  pageId: string;
  when: string;
  side: "before" | "after";
}): string {
  return `${SITE_PREFIX}/screens/${opts.workspaceId}/${opts.entityId}/${opts.pageId}/${opts.when}-${opts.side}.png`;
}

export function diffHunksKey(opts: {
  workspaceId: string;
  entityId: string;
  pageId: string;
  fetchedAt: string;
}): string {
  return `${SITE_PREFIX}/diffs/${opts.workspaceId}/${opts.entityId}/${opts.pageId}/${opts.fetchedAt}.json`;
}

export function buildStoredDiff(opts: {
  workspaceId: string;
  entityId: string;
  pageId: string;
  fetchedAt: string;
  screenshot: { before: string; after: string };
}): StoredDiff {
  return {
    diffR2Key: diffHunksKey({
      workspaceId: opts.workspaceId,
      entityId: opts.entityId,
      pageId: opts.pageId,
      fetchedAt: opts.fetchedAt,
    }),
    screenshotR2Keys: {
      before: opts.screenshot.before,
      after: opts.screenshot.after,
    },
    capturedAt: opts.fetchedAt,
  };
}

const wordChangeSchema = z.object({
  before: z.string(),
  after: z.string(),
  atWord: z.number().int().nonnegative(),
});

const storedHunkSchema = z.object({
  oldStart: z.number().int(),
  oldLines: z.number().int(),
  newStart: z.number().int(),
  newLines: z.number().int(),
  lines: z.array(z.string()),
  atWord: z.number().int().nonnegative(),
});

const pageDiffSchema = z.object({
  changes: z.array(wordChangeSchema),
  hunks: z.array(storedHunkSchema),
  addedWords: z.number().int().nonnegative(),
  removedWords: z.number().int().nonnegative(),
});

export interface SiteArtifacts {
  putText(key: string, body: string, capturedAt: string): Promise<void>;
  putDiffHunks(key: string, diff: PageDiff, capturedAt: string): Promise<void>;
  getText(key: string): Promise<string | null>;
  getDiffHunks(key: string): Promise<PageDiff | null>;
}

export function r2SiteArtifacts(bucket: R2Bucket): SiteArtifacts {
  return {
    async putText(key, body, capturedAt) {
      await bucket.put(key, body, {
        httpMetadata: { contentType: "text/plain; charset=utf-8" },
        customMetadata: { captured_at: capturedAt },
      });
    },
    async putDiffHunks(key, diff, capturedAt) {
      await bucket.put(key, JSON.stringify(diff), {
        httpMetadata: { contentType: "application/json; charset=utf-8" },
        customMetadata: { captured_at: capturedAt },
      });
    },
    async getText(key) {
      const object = await bucket.get(key);
      return object === null ? null : await object.text();
    },
    async getDiffHunks(key) {
      const object = await bucket.get(key);
      if (object === null) return null;
      return pageDiffSchema.parse(JSON.parse(await object.text()));
    },
  };
}
