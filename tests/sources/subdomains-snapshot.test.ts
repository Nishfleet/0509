import { describe, expect, it } from "vitest";

import type { SourceSnapshotRecord, SourceSnapshotInput } from "~/lib/sources/types";
import {
  diffSubdomainSnapshots,
  parseSubdomainPayload,
  type SubdomainSnapshotPayload,
} from "~/lib/sources/subdomains/subdomain-snapshot.server";

function makeSnapshot(
  payload: SubdomainSnapshotPayload,
  overrides: Partial<SourceSnapshotRecord> = {},
): SourceSnapshotRecord {
  return {
    id: overrides.id ?? "snap-1",
    watchlistId: overrides.watchlistId ?? "wl-1",
    sourceId: overrides.sourceId ?? "subdomains",
    fetchedAt: overrides.fetchedAt ?? "2026-01-01T00:00:00.000Z",
    payload: (overrides.payload ?? payload) as unknown as SourceSnapshotRecord["payload"],
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
  };
}

function makePayload(
  domain: string,
  names: Array<{ name: string; kind: "public" | "internal"; firstSeen: string }>,
  truncated = false,
): SubdomainSnapshotPayload {
  return { domain, names, truncated };
}

describe("diffSubdomainSnapshots", () => {
  it("returns [] on first snapshot (baseline — never alerts)", () => {
    const next: SourceSnapshotInput = {
      payload: makePayload("notion.so", [
        { name: "beta.notion.so", kind: "public", firstSeen: "2026-06-01T00:00:00.000Z" },
      ]),
    };
    expect(diffSubdomainSnapshots(null, next)).toEqual([]);
  });

  it("returns [] when no new public names appear", () => {
    const prev = makeSnapshot(
      makePayload("notion.so", [
        { name: "beta.notion.so", kind: "public", firstSeen: "2026-06-01T00:00:00.000Z" },
      ]),
    );
    const next: SourceSnapshotInput = {
      payload: makePayload("notion.so", [
        { name: "beta.notion.so", kind: "public", firstSeen: "2026-06-01T00:00:00.000Z" },
      ]),
    };
    expect(diffSubdomainSnapshots(prev, next)).toEqual([]);
  });

  it("returns a SourceChange for each new public name", () => {
    const prev = makeSnapshot(
      makePayload("notion.so", [
        { name: "api.notion.so", kind: "public", firstSeen: "2026-03-01T00:00:00.000Z" },
      ]),
    );
    const next: SourceSnapshotInput = {
      payload: makePayload("notion.so", [
        { name: "api.notion.so", kind: "public", firstSeen: "2026-03-01T00:00:00.000Z" },
        { name: "beta.notion.so", kind: "public", firstSeen: "2026-06-01T00:00:00.000Z" },
        { name: "ai.notion.so", kind: "public", firstSeen: "2026-07-01T00:00:00.000Z" },
      ]),
    };
    const changes = diffSubdomainSnapshots(prev, next);
    expect(changes).toHaveLength(2);
    expect(changes.map((c) => c.metadata).map((m) => m.subdomain)).toEqual(
      expect.arrayContaining(["beta.notion.so", "ai.notion.so"]),
    );
  });

  it("never alerts on new internal names", () => {
    const prev = makeSnapshot(
      makePayload("notion.so", []),
    );
    const next: SourceSnapshotInput = {
      payload: makePayload("notion.so", [
        { name: "dev.notion.so", kind: "internal", firstSeen: "2026-02-01T00:00:00.000Z" },
        { name: "staging.notion.so", kind: "internal", firstSeen: "2026-02-01T00:00:00.000Z" },
        { name: "mail.notion.so", kind: "internal", firstSeen: "2026-01-01T00:00:00.000Z" },
      ]),
    };
    expect(diffSubdomainSnapshots(prev, next)).toEqual([]);
  });

  it("includes subdomain, firstSeen, and kind in metadata", () => {
    const prev = makeSnapshot(makePayload("notion.so", []));
    const next: SourceSnapshotInput = {
      payload: makePayload("notion.so", [
        { name: "ai.notion.so", kind: "public", firstSeen: "2026-07-01T00:00:00.000Z" },
      ]),
    };
    const [change] = diffSubdomainSnapshots(prev, next);
    expect(change.metadata).toEqual({
      subdomain: "ai.notion.so",
      firstSeen: "2026-07-01T00:00:00.000Z",
      kind: "public",
    });
  });

  it("uses website_page_added as the event type", () => {
    const prev = makeSnapshot(makePayload("notion.so", []));
    const next: SourceSnapshotInput = {
      payload: makePayload("notion.so", [
        { name: "ai.notion.so", kind: "public", firstSeen: "2026-07-01T00:00:00.000Z" },
      ]),
    };
    const [change] = diffSubdomainSnapshots(prev, next);
    expect(change.eventType).toBe("website_page_added");
  });

  it("returns [] when next payload is malformed", () => {
    const prev = makeSnapshot(makePayload("notion.so", []));
    const next: SourceSnapshotInput = {
      payload: { domain: "notion.so" } as unknown as SubdomainSnapshotPayload,
    };
    expect(diffSubdomainSnapshots(prev, next)).toEqual([]);
  });
});

describe("parseSubdomainPayload", () => {
  it("returns null for a null record", () => {
    expect(parseSubdomainPayload(null)).toBeNull();
  });

  it("returns null for a non-subdomain payload", () => {
    const record = makeSnapshot({ domain: "", names: [], truncated: false } as never, {
      payload: { foo: "bar" } as never,
    });
    expect(parseSubdomainPayload(record)).toBeNull();
  });

  it("returns the typed payload for a valid record", () => {
    const record = makeSnapshot(makePayload("notion.so", [
      { name: "beta.notion.so", kind: "public", firstSeen: "2026-06-01T00:00:00.000Z" },
    ]));
    const parsed = parseSubdomainPayload(record);
    expect(parsed?.domain).toBe("notion.so");
    expect(parsed?.names).toHaveLength(1);
  });
});
