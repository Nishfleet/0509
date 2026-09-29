import { env } from "cloudflare:workers";

import { insertSnapshot, latestSiteSnapshot } from "../data/snapshot.server";
import { readUrl, type ReadUrlResult } from "../fetch/transport.server";
import { browserScreenshot } from "./browser-budget.server";
import { extractPageText } from "./extract-text";

export type CheckPageResult =
  | { outcome: "failed"; reason: string; detail: string }
  | { outcome: "unchanged"; snapshotId: string }
  | { outcome: "first"; snapshotId: string; textKey: string; screenshotKey: string | null }
  | {
      outcome: "changed";
      snapshotId: string;
      previousSnapshotId: string;
      previousTextKey: string;
      previousScreenshotKey: string | null;
      previousHash: string;
      textKey: string;
      hash: string;
      screenshotKey: string | null;
      status: number;
      transport: "fetch" | "browser";
    };

const NO_CUTOFF = "9999-12-31T23:59:59.999Z";

function logScreenshotMiss(url: string, cause: string): void {
  console.log(JSON.stringify({
    event: "screenshot-miss",
    url,
    cause,
  }));
}

async function captureScreenshot(
  url: string,
  key: string,
  mayScreenshot: (() => Promise<boolean>) | undefined,
): Promise<string | null> {
  const existing = await storedKey(key);
  if (existing !== null) return existing;
  if (mayScreenshot === undefined) {
    logScreenshotMiss(url, "no screenshot budget granted");
    return null;
  }
  if (!(await mayScreenshot())) {
    logScreenshotMiss(url, "browser budget exhausted");
    return null;
  }
  const shot = await browserScreenshot(url);
  if (!shot.ok) {
    logScreenshotMiss(url, shot.cause);
    return null;
  }
  try {
    await env.SNAPSHOTS.put(key, shot.bytes, {
      httpMetadata: { contentType: "image/png" },
    });
  } catch (err) {
    logScreenshotMiss(url, err instanceof Error ? err.message : String(err));
    return null;
  }
  return key;
}

async function storedKey(key: string): Promise<string | null> {
  return (await env.SNAPSHOTS.head(key)) === null ? null : key;
}

export async function checkPage(input: {
  watchId: string;
  pageId: string;
  url: string;
  snapshotId?: string;
  before?: string;
  read?: ReadUrlResult;
  mayScreenshot?: () => Promise<boolean>;
}): Promise<CheckPageResult> {
  const read = input.read ?? (await readUrl(input.url));
  if (!read.ok) {
    return { outcome: "failed", reason: read.reason, detail: read.detail };
  }

  const extracted = await extractPageText(read.html);
  const fetchedAt = new Date().toISOString();
  const previous = await latestSiteSnapshot(input.watchId, input.pageId, input.before ?? NO_CUTOFF);
  const id = input.snapshotId ?? crypto.randomUUID();

  if (previous !== null && previous.payload_hash === extracted.hash) {
    await insertSnapshot({
      id,
      watchId: input.watchId,
      pageId: input.pageId,
      fetchedAt,
      r2Key: previous.payload_r2_key,
      hash: extracted.hash,
    });
    return { outcome: "unchanged", snapshotId: id };
  }

  const textKey = `snapshot/site/${input.watchId}/${id}.txt`;
  await env.SNAPSHOTS.put(textKey, extracted.text);
  const screenshotKey = await captureScreenshot(
    input.url,
    `snapshot/site/${input.watchId}/${id}.png`,
    input.mayScreenshot,
  );
  await insertSnapshot({
    id,
    watchId: input.watchId,
    pageId: input.pageId,
    fetchedAt,
    r2Key: textKey,
    hash: extracted.hash,
  });

  if (previous?.payload_r2_key == null) {
    return { outcome: "first", snapshotId: id, textKey, screenshotKey };
  }

  return {
    outcome: "changed",
    snapshotId: id,
    previousSnapshotId: previous.id,
    previousTextKey: previous.payload_r2_key,
    previousScreenshotKey: await storedKey(previous.payload_r2_key.replace(/\.txt$/, ".png")),
    previousHash: previous.payload_hash,
    textKey,
    hash: extracted.hash,
    screenshotKey,
    status: read.status,
    transport: read.transport,
  };
}
