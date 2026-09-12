import { describe, expect, it } from "vitest";

import {
  classifyRow,
  isFbcdnCreativeUrl,
  loadRows,
  parseArgs,
} from "../scripts/creative-fbcdn-backfill.mjs";

/**
 * Issue #2981 — the backfill audit must report how many stored captures are
 * already dead. That count is the ticket's deliverable, so the classification
 * is pinned here with a stubbed probe: no network, no fbcdn, no R2.
 */

const FB_URL = "https://scontent-bos5-1.xx.fbcdn.net/v/t39/creative.jpg?oh=abc&oe=6AA7C003";
const HASH = "a".repeat(64);

function probe(outcome: Record<string, unknown>) {
  return async () => outcome;
}

describe("creative-fbcdn-backfill classification", () => {
  it("accepts only fbcdn hosts as fetchable creatives", () => {
    expect(isFbcdnCreativeUrl(new URL(FB_URL))).toBe(true);
    expect(isFbcdnCreativeUrl(new URL("https://example.com/x.jpg"))).toBe(false);
    expect(isFbcdnCreativeUrl(new URL("https://notfbcdn.net.evil.com/x.jpg"))).toBe(false);
    expect(isFbcdnCreativeUrl(null)).toBe(false);
  });

  it("counts an expired signature as dead, with the status as the reason", async () => {
    const result = await classifyRow(
      { id: "ad_1", url: FB_URL },
      { fetchCreative: probe({ kind: "dead", status: 403 }) },
    );

    expect(result.kind).toBe("dead");
    expect(result.detail.reason).toBe("status 403");
  });

  it("counts a still-signed capture as resolved and keeps its content hash", async () => {
    const result = await classifyRow(
      { id: "ad_2", url: FB_URL },
      {
        fetchCreative: probe({
          kind: "resolved",
          hash: HASH,
          contentType: "image/jpeg",
          bytes: new Uint8Array([1, 2, 3]),
        }),
      },
    );

    expect(result.kind).toBe("resolved");
    expect(result.detail.hash).toBe(HASH);
    expect(result.detail.contentType).toBe("image/jpeg");
  });

  it("treats a non-fbcdn or unparseable URL as dead without probing", async () => {
    let probed = 0;
    const countingProbe = async () => {
      probed += 1;
      return { kind: "resolved", hash: HASH, contentType: "image/jpeg", bytes: new Uint8Array() };
    };

    const foreign = await classifyRow(
      { id: "ad_3", url: "https://example.com/x.jpg" },
      { fetchCreative: countingProbe },
    );
    const malformed = await classifyRow(
      { id: "ad_4", url: "not a url" },
      { fetchCreative: countingProbe },
    );

    expect(foreign.kind).toBe("dead");
    expect(foreign.detail.reason).toBe("unusable url");
    expect(malformed.kind).toBe("dead");
    // Neither reached the network.
    expect(probed).toBe(0);
  });
});

describe("creative-fbcdn-backfill CLI surface", () => {
  it("reads rows out of wrangler's statement-envelope JSON", () => {
    const rows = loadRows("tests/fixtures/creative-fbcdn-rows.envelope.json");
    expect(rows).toEqual([
      { id: "ad_live", url: FB_URL },
      { id: "ad_dead", url: "https://x.fbcdn.net/gone.jpg" },
    ]);
  });

  it("parses the documented flags", () => {
    const args = parseArgs(["--d1-json", "rows.json", "--json"]);
    expect(args.d1Json).toBe("rows.json");
    expect(args.json).toBe(true);
    expect(args.r2).toBe(false);
  });
});
