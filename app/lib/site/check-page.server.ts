import { env } from "cloudflare:workers";

import { insertSnapshot, latestSiteSnapshot } from "../data/snapshot.server";
import { readUrl } from "../fetch/transport.server";
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
      previousScreenshotKey: string;
      textKey: string;
      screenshotKey: string | null;
      status: number;
      transport: "fetch" | "browser";
    };

async function captureScreenshot(url: string, key: string): Promise<string | null> {
  if (!env.BROWSER) return null;
  try {
    const res = await env.BROWSER.quickAction("screenshot", {
      url,
      viewport: { width: 1440, height: 900 },
    });
    if (!res.ok) return null;
    await env.SNAPSHOTS.put(key, await res.arrayBuffer(), {
      httpMetadata: { contentType: "image/png" },
    });
    return key;
  } catch {
    return null;
  }
}

export async function checkPage(input: {
  watchId: string;
  pageId: string;
  url: string;
}): Promise<CheckPageResult> {
  const read = await readUrl(input.url);
  if (!read.ok) {
    return { outcome: "failed", reason: read.reason, detail: read.detail };
  }

  const extracted = await extractPageText(read.html);
  const previous = await latestSiteSnapshot(input.watchId, input.pageId);
  const id = crypto.randomUUID();
  const fetchedAt = new Date().toISOString();

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
    previousScreenshotKey: previous.payload_r2_key.replace(".txt", ".png"),
    textKey,
    screenshotKey,
    status: read.status,
    transport: read.transport,
  };
}
