import { describe, expect, it } from "vitest";

import { daysAgoLabel } from "../../app/lib/delivery-alert";
import {
  alsoReportedLine,
  mentionsFromRows,
  mentionWhen,
  showInFeed,
  withoutMentionAlerts,
  type MentionReadRow,
} from "../../app/lib/mention-feed";
import { sourceName } from "../../app/lib/source-name";

const NOW = new Date("2026-09-25T12:00:00.000Z");

function row(overrides: Partial<MentionReadRow> & Pick<MentionReadRow, "id" | "p">): MentionReadRow {
  return {
    title: overrides.title ?? "Zephyrwear opens a London flagship",
    url: overrides.url ?? "https://news.example/flagship",
    platform: overrides.platform ?? "gdelt",
    kind: overrides.kind ?? "mentions",
    publishedAt: overrides.publishedAt === undefined ? "2026-09-24T08:00:00.000Z" : overrides.publishedAt,
    observedAt: overrides.observedAt ?? "2026-09-25T08:00:00.000Z",
    reason: overrides.reason === undefined ? "A London flagship is a move worth knowing." : overrides.reason,
    verdictId: overrides.verdictId === undefined ? `v-${overrides.id}` : overrides.verdictId,
    verdictDecidedAt:
      overrides.verdictDecidedAt === undefined ? "2026-09-25T09:00:00.000Z" : overrides.verdictDecidedAt,
    id: overrides.id,
    p: overrides.p,
    state: overrides.state ?? null,
    alsoCount: overrides.alsoCount ?? 0,
  };
}

describe("alsoReportedLine", () => {
  it("uses the singular noun for one source and the plural for more", () => {
    expect(alsoReportedLine(1)).toBe("Also reported by 1 other source");
    expect(alsoReportedLine(3)).toBe("Also reported by 3 other sources");
  });
});

describe("mentionWhen", () => {
  it("says found today when there is no published date and matches daysAgoLabel otherwise", () => {
    const twoDaysAgo = "2026-09-23T12:00:00.000Z";
    expect(mentionWhen(null, NOW)).toBe("found today");
    expect(mentionWhen(twoDaysAgo, NOW)).toBe(daysAgoLabel(twoDaysAgo, NOW));
    expect(mentionWhen(twoDaysAgo, NOW)).toBe("2 days ago");
  });
});

describe("mentionsFromRows", () => {
  it("drops rows with a blank title or an empty url and trims the title", () => {
    const mentions = mentionsFromRows(
      [
        row({ id: "blank-title", p: 0.95, title: "   " }),
        row({ id: "empty-url", p: 0.95, url: "" }),
        row({ id: "kept", p: 0.95, title: "  Zephyrwear  " }),
      ],
      NOW,
    );
    expect(mentions.map((mention) => mention.id)).toEqual(["kept"]);
    expect(mentions[0]?.title).toBe("Zephyrwear");
  });

  it("marks an unjudged row as pending even with a high score, and leaves whyFlagged null without a verdict", () => {
    const [withVerdict, withoutVerdict] = mentionsFromRows(
      [
        row({ id: "unjudged", p: 0.9, state: "unjudged" }),
        row({ id: "unjudged-no-verdict", p: 0.9, state: "unjudged", verdictId: null, verdictDecidedAt: null }),
      ],
      NOW,
    );
    expect(withVerdict.treatment).toBe("pending");
    expect(withVerdict.whyFlagged).not.toBeNull();
    expect(withoutVerdict.treatment).toBe("pending");
    expect(withoutVerdict.whyFlagged).toBeNull();
  });

  it("treats a null or non-finite p as unreviewed", () => {
    const [nullP, nanP] = mentionsFromRows([row({ id: "null-p", p: null }), row({ id: "nan-p", p: Number.NaN })], NOW);
    expect(nullP.treatment).toBe("unreviewed");
    expect(nanP.treatment).toBe("unreviewed");
  });

  it("sets why to null when the reason is blank", () => {
    const [mention] = mentionsFromRows([row({ id: "blank-reason", p: 0.95, reason: "   " })], NOW);
    expect(mention.why).toBe(null);
  });

  it("reads the source name from kind and platform", () => {
    const [hn, medium, unknown, site] = mentionsFromRows(
      [
        row({ id: "hn", p: 0.95, kind: "mentions", platform: "hn" }),
        row({ id: "medium", p: 0.95, kind: "mentions", platform: "medium" }),
        row({ id: "unknown", p: 0.95, kind: "mentions", platform: "nowhere" }),
        row({ id: "site", p: 0.95, kind: "site", platform: "gdelt" }),
      ],
      NOW,
    );
    expect(hn.sourceName).toBe("Hacker News mentions");
    expect(medium.sourceName).toBe("Medium mentions");
    expect(unknown.sourceName).toBe("Your mentions source");
    expect(site.sourceName).toBe("Website checks");
    expect(hn.sourceName).toBe(sourceName("mentions", "hn"));
    expect(site.sourceName).toBe(sourceName("site", "gdelt"));
  });
});

describe("showInFeed", () => {
  it("always shows a non-mention item", () => {
    expect(showInFeed({ kind: "ad" }, false)).toBe(true);
    expect(showInFeed({ kind: "ad" }, true)).toBe(true);
    expect(showInFeed({ kind: "alert", mention: undefined }, false)).toBe(true);
  });

  it("hides a held mention until show all is on", () => {
    const held = { kind: "mention", mention: { treatment: "held" } };
    expect(showInFeed(held, false)).toBe(false);
    expect(showInFeed(held, true)).toBe(true);
  });

  it("shows every mention treatment that is not held", () => {
    for (const treatment of ["shown", "possibly", "unreviewed", "pending"] as const) {
      expect(showInFeed({ kind: "mention", mention: { treatment } }, false)).toBe(true);
    }
  });
});

describe("withoutMentionAlerts", () => {
  it("removes mention entries and returns a new array", () => {
    const signals = [
      { kind: "mention", id: "m1" },
      { kind: "ad", id: "a1" },
      { kind: "mention", id: "m2" },
    ];
    const result = withoutMentionAlerts(signals);
    expect(result.map((signal) => signal.id)).toEqual(["a1"]);
    expect(result).not.toBe(signals);
    expect(signals.map((signal) => signal.id)).toEqual(["m1", "a1", "m2"]);
  });
});
