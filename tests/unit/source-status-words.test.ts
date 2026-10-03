import { describe, expect, it } from "vitest";

import { BLIND_REASON } from "../../app/lib/observability/pipeline-health";
import { LOST_CHANNEL_REASON, NO_CHANNEL_REASON } from "../../app/lib/mentions/youtube-channel";
import { sourceName } from "../../app/lib/source-name";
import { plainSourceReason } from "../../app/lib/source-status-words";

const RAW_REASONS = [
  "blocked: HTTP 429",
  "blocked: HTTP 403",
  "blocked: HTTP 202",
  "timed out",
  "not answering",
  "no fresh data",
  "no reason recorded",
  "watch config is unreadable",
  BLIND_REASON,
  LOST_CHANNEL_REASON,
  NO_CHANNEL_REASON,
  "HTTP 500 from api.gdeltproject.org",
  "",
  null,
];

const PLATFORMS = ["gdelt", "hn", "reddit", "youtube", "web", "lever", "greenhouse", "ashby", "meta", "google"];
const KINDS = ["mentions", "site", "hiring", "ads", "other"];

describe("what a customer reads about a source", () => {
  it("never carries a status code, a codename or a pipeline word, whatever the stored reason", () => {
    for (const raw of RAW_REASONS) {
      const words = plainSourceReason(raw);
      expect(words, String(raw)).not.toMatch(/http|\b\d{3}\b|gdelt|canary|config|tick|re-resolv/i);
      expect(words.length).toBeGreaterThan(0);
    }
  });

  it("names every source in plain words, never by its key", () => {
    for (const kind of KINDS) {
      for (const platform of PLATFORMS) {
        expect(sourceName(kind, platform), `${kind} ${platform}`).not.toMatch(/gdelt|\.|_/i);
      }
    }
  });

  it("says a blocked answer is simply not answering right now", () => {
    expect(plainSourceReason("blocked: HTTP 429")).toBe("not answering right now");
  });
});
