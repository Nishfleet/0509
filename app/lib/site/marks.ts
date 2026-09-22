import type { PageDiff, StoredHunk } from "./diff";

export interface R2Ref {
  key: string;
  bytes: number;
  contentType: string;
}

export interface MarkStore {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string | null | ReadableStream,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
}

interface MarkBody {
  hunks: StoredHunk[];
  changes: PageDiff["changes"];
}

export interface MarkKeys {
  beforeTextKey: string;
  afterTextKey: string;
  beforeScreenshotKey: string;
  afterScreenshotKey: string;
  hunksKey: string;
}

export function markKey(
  watchId: string,
  capturedAt: string,
  role: "before-text" | "after-text" | "before-shot" | "after-shot" | "hunks",
  extension: "txt" | "png" | "json",
): string {
  if (!watchId) throw new Error("watchId is required to build a mark key");
  if (!capturedAt) throw new Error("capturedAt is required to build a mark key");
  const stamp = capturedAt.replace(/[:.]/g, "-");
  return `marks/${watchId}/${stamp}/${role}.${extension}`;
}

async function putTextBody(
  store: MarkStore,
  key: string,
  text: string,
): Promise<R2Ref> {
  const body = new TextEncoder().encode(text);
  await store.put(key, body, { httpMetadata: { contentType: "text/plain; charset=utf-8" } });
  return { key, bytes: body.byteLength, contentType: "text/plain; charset=utf-8" };
}

async function putScreenshots(
  store: MarkStore,
  beforeKey: string,
  afterKey: string,
  beforeBytes: ArrayBuffer,
  afterBytes: ArrayBuffer,
): Promise<{ before: R2Ref; after: R2Ref }> {
  await store.put(beforeKey, beforeBytes, { httpMetadata: { contentType: "image/png" } });
  await store.put(afterKey, afterBytes, { httpMetadata: { contentType: "image/png" } });
  return {
    before: { key: beforeKey, bytes: beforeBytes.byteLength, contentType: "image/png" },
    after: { key: afterKey, bytes: afterBytes.byteLength, contentType: "image/png" },
  };
}

async function putMarkBody(
  store: MarkStore,
  key: string,
  body: MarkBody,
): Promise<R2Ref> {
  const encoded = new TextEncoder().encode(JSON.stringify(body));
  await store.put(key, encoded, { httpMetadata: { contentType: "application/json" } });
  return { key, bytes: encoded.byteLength, contentType: "application/json" };
}

export async function storeMark(
  store: MarkStore,
  keys: MarkKeys,
  diff: PageDiff,
  beforeText: string,
  afterText: string,
  beforeScreenshot: ArrayBuffer,
  afterScreenshot: ArrayBuffer,
): Promise<{ keys: MarkKeys; refs: Record<keyof MarkKeys, R2Ref> }> {
  if (diff.changes.length === 0 && diff.hunks.length === 0) {
    throw new Error(
      "refusing to store a mark with no changes: an unchanged tick writes one snapshot row and nothing else",
    );
  }

  const beforeTextRef = await putTextBody(store, keys.beforeTextKey, beforeText);
  const afterTextRef = await putTextBody(store, keys.afterTextKey, afterText);
  const shots = await putScreenshots(
    store,
    keys.beforeScreenshotKey,
    keys.afterScreenshotKey,
    beforeScreenshot,
    afterScreenshot,
  );
  const bodyRef = await putMarkBody(store, keys.hunksKey, {
    hunks: diff.hunks,
    changes: diff.changes,
  });

  return {
    keys,
    refs: {
      beforeTextKey: beforeTextRef,
      afterTextKey: afterTextRef,
      beforeScreenshotKey: shots.before,
      afterScreenshotKey: shots.after,
      hunksKey: bodyRef,
    },
  };
}

export function markKeys(keys: MarkKeys): MarkKeys {
  return {
    beforeTextKey: keys.beforeTextKey,
    afterTextKey: keys.afterTextKey,
    beforeScreenshotKey: keys.beforeScreenshotKey,
    afterScreenshotKey: keys.afterScreenshotKey,
    hunksKey: keys.hunksKey,
  };
}
