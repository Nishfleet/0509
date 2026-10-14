import { describe, expect, it } from "vitest";

import { ledgerFooter, ledgerSummary, quietLedgerLine, type WorkLedger } from "../../app/lib/work-ledger";

const BASE: WorkLedger = {
  rivals: 5,
  pages_read: 31,
  changes_seen: 4,
  changes_told: 1,
  changes_set_aside: 3,
  mentions_read: 40,
  mentions_kept: 2,
};

describe("the work ledger", () => {
  it("says what was read, seen and kept, and what stayed off the brief", () => {
    expect(ledgerSummary(BASE, "This week we")).toBe(
      "This week we read 31 pages across 5 rivals; saw 4 changes, 1 worth your time; read 40 mentions and kept 2. 3 changes judged too small to interrupt you stayed off the brief.",
    );
  });

  it("turns a quiet week into proof of work, never into a bare zero", () => {
    expect(quietLedgerLine({ ...BASE, changes_seen: 0, changes_told: 0, changes_set_aside: 0, mentions_read: 0 })).toBe(
      "Quiet week: we read 31 pages across 5 rivals; saw no changes.",
    );
    expect(quietLedgerLine({ ...BASE, changes_told: 0 })).toContain("saw 4 changes, none worth your time");
  });

  it("claims nothing when nothing was read", () => {
    const none: WorkLedger = {
      ...BASE,
      pages_read: 0,
      changes_seen: 0,
      changes_told: 0,
      changes_set_aside: 0,
      mentions_read: 0,
    };
    expect(ledgerSummary(none, "This week we")).toBeNull();
    expect(ledgerSummary(undefined, "This week we")).toBeNull();
    expect(quietLedgerLine(none)).toBeNull();
  });

  it("uses the singular", () => {
    expect(
      ledgerSummary(
        {
          rivals: 1,
          pages_read: 1,
          changes_seen: 1,
          changes_told: 1,
          changes_set_aside: 0,
          mentions_read: 1,
          mentions_kept: 1,
        },
        "This month we",
      ),
    ).toBe("This month we read 1 page across 1 rival; saw 1 change, 1 worth your time; read 1 mention and kept 1.");
  });

  it("does not say the week twice when the headline already did", () => {
    const quiet: WorkLedger = { ...BASE, changes_told: 0 };
    const headline = quietLedgerLine(quiet) ?? "";
    expect(ledgerFooter(quiet, headline)).toBe("3 changes judged too small to interrupt you stayed off the brief.");
    expect(ledgerFooter({ ...quiet, changes_set_aside: 0 }, headline)).toBeNull();
    expect(ledgerFooter(BASE, "2 of 4 changes worth reading this week, led by Acme.")).toBe(
      ledgerSummary(BASE, "This week we"),
    );
    expect(ledgerFooter(undefined, headline)).toBeNull();
  });
});
