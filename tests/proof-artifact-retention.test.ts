import { describe, expect, it, vi } from "vitest";

import {
  compensateUncommittedProofArtifacts,
  deleteProofArtifacts,
  getProofArtifactInventory,
  getProofArtifactForOwner,
  headProofArtifactForOwner,
  isKnownProofArtifactKey,
  MAX_PROOF_ARTIFACT_DELETE_KEYS,
  parseProofArtifactKey,
} from "~/lib/proof-artifact-retention.server";

const HTML_KEY = "landing-pages/2026-07-16/0123456789abcdef0123456789abcdef.html";
const SCREENSHOT_KEY = "landing-pages/2026-07-16/fedcba9876543210fedcba9876543210.jpeg";
const OWNER = "workspace-owner";
const OTHER_OWNER = "other-workspace";

type InventoryRow = {
  reference_count: number;
  owner_count: number;
  owner_match_count: number;
  landing_page_snapshot_references: number;
  proof_capture_references: number;
};

function fakeEnv(row: InventoryRow, r2?: Record<string, unknown>) {
  const prepare = vi.fn(() => ({
    bind: vi.fn(() => ({
      all: vi.fn(async () => ({ results: [row] })),
      run: vi.fn(async () => ({ meta: { changes: 1 } })),
    })),
  }));
  return {
    DB: { prepare } as unknown as D1Database,
    LANDING_PAGE_ARTIFACTS: r2 as unknown as R2Bucket,
    prepare,
  };
}

function objectHead(key: string): R2Object {
  return { key, size: 1 } as unknown as R2Object;
}

describe("proof artifact retention contract", () => {
  it("compensates every fresh artifact when D1 ownership was not committed", async () => {
    const del = vi.fn(async (_key: string) => undefined);
    const result = await compensateUncommittedProofArtifacts(
      { LANDING_PAGE_ARTIFACTS: { delete: del } as unknown as R2Bucket } as never,
      {
        rawUrl: "https://0509.io/",
        canonicalUrl: "https://0509.io/",
        rawHeadline: "0509",
        normalizedHeadline: "0509",
        normalizedHeadlineHash: "hash",
        captureMethod: "browser_render",
        capturedAt: "2026-07-18T00:00:00.000Z",
        artifactKey: HTML_KEY,
        metadata: { screenshotArtifactKey: SCREENSHOT_KEY },
      },
    );
    expect(result).toEqual({ ok: true, deleted: 2, failed: 0 });
    expect(del.mock.calls.map(([key]) => key)).toEqual([HTML_KEY, SCREENSHOT_KEY]);
  });

  it("accepts only producer-owned HTML and screenshot key shapes", () => {
    expect(parseProofArtifactKey(HTML_KEY)).toEqual({ key: HTML_KEY, kind: "html" });
    expect(parseProofArtifactKey(SCREENSHOT_KEY)).toEqual({ key: SCREENSHOT_KEY, kind: "screenshot" });
    expect(isKnownProofArtifactKey(HTML_KEY)).toBe(true);
    for (const key of [
      "landing-pages/page.html",
      "landing-pages/2026-07-16/not-hex.html",
      "landing-pages/2026-7-16/0123456789abcdef0123456789abcdef.html",
      "proof/secret.png",
      "../landing-pages/2026-07-16/0123456789abcdef0123456789abcdef.html",
      `${HTML_KEY}?token=secret`,
    ]) {
      expect(parseProofArtifactKey(key)).toBeNull();
      expect(isKnownProofArtifactKey(key)).toBe(false);
    }
  });

  it("denies cross-workspace head/get without touching R2", async () => {
    const head = vi.fn();
    const get = vi.fn();
    const env = fakeEnv(
      {
        reference_count: 1,
        owner_count: 1,
        owner_match_count: 0,
        landing_page_snapshot_references: 1,
        proof_capture_references: 0,
      },
      { head, get },
    );

    expect(await headProofArtifactForOwner(env, OTHER_OWNER, HTML_KEY)).toBeNull();
    expect(await getProofArtifactForOwner(env, OTHER_OWNER, HTML_KEY)).toBeNull();
    expect(head).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it("reports shared ownership without projecting owner ids", async () => {
    const env = fakeEnv({
      reference_count: 2,
      owner_count: 2,
      owner_match_count: 1,
      landing_page_snapshot_references: 1,
      proof_capture_references: 1,
    });

    const inventory = await getProofArtifactInventory(env, HTML_KEY, OWNER);
    expect(inventory).toMatchObject({
      key: HTML_KEY,
      kind: "html",
      referenceState: "shared",
      referenceCount: 2,
      ownerCount: 2,
      ownerHasReference: true,
    });
    expect(JSON.stringify(inventory)).not.toContain(OWNER);
    expect(JSON.stringify(inventory)).not.toContain(OTHER_OWNER);
  });

  it("revokes only the requesting owner's shared reference without touching R2", async () => {
    const head = vi.fn();
    const del = vi.fn();
    const env = fakeEnv(
      {
        reference_count: 2,
        owner_count: 2,
        owner_match_count: 1,
        landing_page_snapshot_references: 0,
        proof_capture_references: 2,
      },
      { head, delete: del },
    );

    const [result] = await deleteProofArtifacts(env, OWNER, [SCREENSHOT_KEY]);
    expect(result).toEqual({
      key: SCREENSHOT_KEY,
      ok: true,
      outcome: "revoked_shared",
      r2: "not_attempted",
      d1: "updated",
    });
    expect(head).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("does not delete an unreferenced object merely because it is present in R2", async () => {
    const head = vi.fn();
    const env = fakeEnv(
      {
        reference_count: 0,
        owner_count: 0,
        owner_match_count: 0,
        landing_page_snapshot_references: 0,
        proof_capture_references: 0,
      },
      { head },
    );

    const [result] = await deleteProofArtifacts(env, OWNER, [HTML_KEY]);
    expect(result).toMatchObject({ ok: false, outcome: "unreferenced", r2: "not_attempted", d1: "not_updated" });
    expect(head).not.toHaveBeenCalled();
  });

  it("keeps HTML and screenshot R2 delete failures explicit", async () => {
    const htmlHead = vi.fn(async () => objectHead(HTML_KEY));
    const htmlDelete = vi.fn(async () => {
      throw new Error("r2 unavailable");
    });
    const screenshotHead = vi.fn(async () => objectHead(SCREENSHOT_KEY));
    const screenshotDelete = vi.fn(async () => {
      throw new Error("r2 unavailable");
    });
    const htmlEnv = fakeEnv(
      { reference_count: 1, owner_count: 1, owner_match_count: 1, landing_page_snapshot_references: 0, proof_capture_references: 1 },
      { head: htmlHead, delete: htmlDelete },
    );
    const screenshotEnv = fakeEnv(
      { reference_count: 1, owner_count: 1, owner_match_count: 1, landing_page_snapshot_references: 0, proof_capture_references: 1 },
      { head: screenshotHead, delete: screenshotDelete },
    );

    const [htmlResult] = await deleteProofArtifacts(htmlEnv, OWNER, [HTML_KEY]);
    const [screenshotResult] = await deleteProofArtifacts(screenshotEnv, OWNER, [SCREENSHOT_KEY]);
    expect(htmlResult).toMatchObject({ ok: false, outcome: "r2_failed", r2: "failed", d1: "not_updated" });
    expect(screenshotResult).toMatchObject({ ok: false, outcome: "r2_failed", r2: "failed", d1: "not_updated" });
  });

  it("converges on retry and treats a missing R2 object as an idempotent success", async () => {
    let present = true;
    const head = vi.fn(async () => (present ? objectHead(HTML_KEY) : null));
    const del = vi.fn(async () => {
      present = false;
    });
    const env = fakeEnv(
      { reference_count: 1, owner_count: 1, owner_match_count: 1, landing_page_snapshot_references: 0, proof_capture_references: 1 },
      { head, delete: del },
    );

    const first = await deleteProofArtifacts(env, OWNER, [HTML_KEY]);
    const second = await deleteProofArtifacts(env, OWNER, [HTML_KEY]);
    expect(first[0]).toMatchObject({ ok: true, outcome: "deleted", r2: "deleted", d1: "updated" });
    expect(second[0]).toMatchObject({ ok: true, outcome: "missing", r2: "missing", d1: "updated" });
    expect(del).toHaveBeenCalledTimes(1);
  });

  it("bounds batches and reports invalid or duplicate keys per key", async () => {
    const env = fakeEnv({
      reference_count: 0,
      owner_count: 0,
      owner_match_count: 0,
      landing_page_snapshot_references: 0,
      proof_capture_references: 0,
    });
    await expect(deleteProofArtifacts(env, OWNER, Array.from({ length: MAX_PROOF_ARTIFACT_DELETE_KEYS + 1 }, () => HTML_KEY))).rejects.toThrow(
      "proof_artifact_delete_bound_exceeded",
    );
    const results = await deleteProofArtifacts(env, OWNER, ["bad-key", "bad-key"]);
    expect(results).toEqual([
      { key: "bad-key", ok: false, outcome: "invalid_key", r2: "not_attempted", d1: "not_updated" },
      { key: "bad-key", ok: false, outcome: "invalid_key", r2: "not_attempted", d1: "not_updated" },
    ]);
  });
});
