import type { PageDiff, StoredHunk } from "./diff";

/**
 * The before-and-after mark — engine 4, P3.
 *
 * A mark is the object the whole product shows: two texts, two screenshots and
 * the stored hunks, every one of them an R2 key. Nothing heavy travels through
 * D1 and nothing heavy travels through a Workflow step.
 *
 * THE THREE HARD RULES, each encoded here rather than left to a caller:
 *
 * 1. Screenshots are R2 keys, never base64 in a D1 row. `putTextBody` and
 *    `putPairs` write bytes to R2 and return the key. There is no function in
 *    this file that returns image bytes, so there is no way to accidentally
 *    widen the mark into a D1 payload.
 *
 * 2. A Workflow step returns keys, never bodies. `markKeys` returns the small
 *    reference object (ids and keys) that a step may pass on; `markBody` is the
 *    object that stays alongside the bytes in R2 and is only ever read back by
 *    the surface that renders the mark. The 1 MiB step-output cap is what makes
 *    the distinction load-bearing.
 *
 * 3. Screenshots are evidence, never the detector. Nothing here hashes,
 *    compares or diffs an image; the capture functions take keys that the
 *    escalation path already decided to write, after the text hash said
 *    something changed.
 */

/** An R2 object reference. A key plus the evidence D1 and the UI both need. */
export interface R2Ref {
  /** The R2 object key. The only thing D1 stores. */
  key: string;
  /** Bytes written, so the cost line and the retention rule have a number. */
  bytes: number;
  /** `text/plain` or `image/png`, recorded at write time. */
  contentType: string;
}

/**
 * The R2 namespace surface this module uses. Declared structurally rather than
 * imported from `@cloudflare/workers-types` so the same code runs against a
 * real binding and against the test double without a cast, and so the surface
 * is exactly the two methods a mark needs.
 */
export interface MarkStore {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string | null | ReadableStream,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
}

/** Everything a rendered mark shows. Stored in R2; never in a step output. */
interface MarkBody {
  /** The whitespace-normalised before text, as a string. */
  beforeText: string;
  /** The whitespace-normalised after text, as a string. */
  afterText: string;
  /** The stored hunks with their page position. */
  hunks: StoredHunk[];
  /** Word-level changes, for the inline copy view. */
  changes: PageDiff["changes"];
}

/** The reference object that may cross a Workflow step boundary. */
export interface MarkKeys {
  /** R2 key of the before extracted text. */
  beforeTextKey: string;
  /** R2 key of the after extracted text. */
  afterTextKey: string;
  /** R2 key of the before screenshot. */
  beforeScreenshotKey: string;
  /** R2 key of the after screenshot. */
  afterScreenshotKey: string;
  /** R2 key of the stored hunks body. */
  hunksKey: string;
}

/**
 * One key per object, deterministic from the watch, the moment and the role, so
 * a retried step writes the same key instead of orphaning a stray object — the
 * retry-safety the Workflow's `step.do` retries depend on. The role is part of
 * the key rather than a suffix on a shared key because a before and an after
 * text of the same tick must never collide.
 */
export function markKey(
  watchId: string,
  capturedAt: string,
  role: "before-text" | "after-text" | "before-shot" | "after-shot" | "hunks",
  extension: "txt" | "png" | "json",
): string {
  if (!watchId) throw new Error("watchId is required to build a mark key");
  if (!capturedAt) throw new Error("capturedAt is required to build a mark key");
  // A compact, filesystem-safe stamp. A date string with colons and dots in an
  // R2 key is legal but unreadable in an incident, and the underscores keep the
  // key sortable by tick for a prefix listing.
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

/** A screenshot pair, already captured, already PNG. Evidence, never a detector. */
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

/** Write the stored mark body (hunks plus the text pair) as one JSON object. */
async function putMarkBody(
  store: MarkStore,
  key: string,
  body: MarkBody,
): Promise<R2Ref> {
  const encoded = new TextEncoder().encode(JSON.stringify(body));
  await store.put(key, encoded, { httpMetadata: { contentType: "application/json" } });
  return { key, bytes: encoded.byteLength, contentType: "application/json" };
}

/**
 * Assemble a mark: two texts, two screenshots and the hunks all in R2, with the
 * reference object that D1's snapshot and signal rows store.
 *
 * The caller supplies the already-captured bytes because capture belongs to the
 * escalation path (P2), not here — and because making this function capture
 * would make it untestable without a browser. The one thing this function
 * enforces is the packet's ordering rule: it refuses a `PageDiff` that the hash
 * gate never produced, which can only happen if a caller built one by hand.
 */
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
    beforeText,
    afterText,
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

/**
 * The small object a Workflow step may return: keys and counts, no bodies.
 * This is the function the sweep's `step.do` uses; `storeMark`'s refs stay in
 * the consumer that has the bytes.
 */
export function markKeys(keys: MarkKeys): MarkKeys {
  return {
    beforeTextKey: keys.beforeTextKey,
    afterTextKey: keys.afterTextKey,
    beforeScreenshotKey: keys.beforeScreenshotKey,
    afterScreenshotKey: keys.afterScreenshotKey,
    hunksKey: keys.hunksKey,
  };
}
