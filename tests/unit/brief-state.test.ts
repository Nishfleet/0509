import { describe, expect, it } from "vitest";

import { briefSendLine } from "../../app/lib/brief-state";

describe("briefSendLine", () => {
  it("words a sent brief with its date when sent_at is present", () => {
    expect(briefSendLine({ status: "sent", sent_at: "2026-09-21T08:00:03.000Z" })).toBe("Sent 2026-09-21");
  });

  it("words a sent brief without a date when sent_at is null", () => {
    expect(briefSendLine({ status: "sent", sent_at: null })).toBe("Sent");
  });

  it("words a failed brief as one the mail service kept refusing", () => {
    expect(briefSendLine({ status: "failed", sent_at: null })).toBe(
      "Could not be sent: the mail service kept refusing it, so we stopped trying.",
    );
  });

  it("words a paused brief as one the owner paused that week", () => {
    expect(briefSendLine({ status: "paused", sent_at: null })).toBe(
      "Not sent: your brief was paused that week.",
    );
  });

  it("words a cancelled brief as one cancelled before it went out", () => {
    expect(briefSendLine({ status: "cancelled", sent_at: null })).toBe(
      "Not sent: it was cancelled before it went out.",
    );
  });

  it("words an unrecognized status as not sent yet", () => {
    expect(briefSendLine({ status: "pending", sent_at: null })).toBe("Not sent yet");
  });

  it("never claims a brief was delivered", () => {
    const lines = [
      briefSendLine({ status: "sent", sent_at: "2026-09-21T08:00:03.000Z" }),
      briefSendLine({ status: "sent", sent_at: null }),
      briefSendLine({ status: "failed", sent_at: null }),
      briefSendLine({ status: "paused", sent_at: null }),
      briefSendLine({ status: "cancelled", sent_at: null }),
      briefSendLine({ status: "pending", sent_at: null }),
    ];
    for (const line of lines) {
      expect(line).not.toMatch(/deliver/i);
    }
  });
});
