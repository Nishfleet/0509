import { describe, expect, it } from "vitest";

import { errorText, sendMessage, sendOrThrow } from "../../workers/delivery/send";

interface Failure {
  value: unknown;
  sync: boolean;
}

interface Recorder {
  sent: EmailMessageBuilder[];
  fail: Failure | null;
}

const MESSAGE: EmailMessageBuilder = {
  to: "reader@0509.io",
  from: "hello@0509.io",
  subject: "Sign in",
  text: "Use this link once",
};

const recorder = (): Recorder => ({ sent: [], fail: null });

const failing = (value: unknown, sync = false): Failure => ({ value, sync });

const bindingFor = (rec: Recorder): SendEmail => ({
  send(message: EmailMessageBuilder): Promise<EmailSendResult> {
    if (rec.fail?.sync) throw rec.fail.value;
    if (rec.fail) return Promise.reject(rec.fail.value);
    rec.sent.push(message);
    return Promise.resolve({ messageId: "m-1" });
  },
});

describe("errorText", () => {
  it("reads an Error's message", () => {
    expect(errorText(new Error("smtp down"))).toBe("smtp down");
  });

  it("appends the cause's message when the cause is an Error", () => {
    const end = new Error("send failed", { cause: new Error("connection reset") });
    expect(errorText(end)).toBe("send failed: connection reset");
  });

  it("adds no suffix when the cause is not an Error", () => {
    const withPlainCause = new Error("send failed", { cause: { code: 535 } });
    expect(errorText(withPlainCause)).toBe("send failed");

    const withNoCause = new Error("send failed");
    expect(errorText(withNoCause)).toBe("send failed");
  });

  it("stringifies a value that is not an Error", () => {
    expect(errorText("plain string")).toBe("plain string");
    expect(errorText(42)).toBe("42");
    expect(errorText(null)).toBe("null");
    expect(errorText(undefined)).toBe("undefined");
    expect(errorText({ code: 535 })).toBe("[object Object]");
  });

  it("cuts the text at 2,000 characters", () => {
    const longValue = "a".repeat(2_500);
    expect(errorText(longValue)).toBe("a".repeat(2_000));

    const longMessage = "b".repeat(2_500);
    expect(errorText(new Error(longMessage))).toBe("b".repeat(2_000));
  });

  it("counts the cause suffix toward the cut", () => {
    const end = new Error("c".repeat(1_990), { cause: new Error("d".repeat(500)) });
    const text = errorText(end);
    expect(text).toHaveLength(2_000);
    expect(text.endsWith("d")).toBe(true);
  });
});

describe("sendMessage", () => {
  it("resolves 'sent' when the binding resolves", async () => {
    const rec = recorder();

    const result = await sendMessage(bindingFor(rec), MESSAGE);

    expect(result).toEqual({ outcome: "sent", error: null });
    expect(rec.sent).toEqual([MESSAGE]);
  });

  it("resolves 'failed' with the error text when the binding rejects, and never throws", async () => {
    const rec = recorder();
    rec.fail = failing(new Error("Email Service rejected the send"));

    const result = await sendMessage(bindingFor(rec), MESSAGE);

    expect(result).toEqual({ outcome: "failed", error: "Email Service rejected the send" });
    expect(rec.sent).toEqual([]);
  });

  it("resolves 'failed' when the binding throws synchronously", async () => {
    const rec = recorder();
    rec.fail = failing(new Error("binding is closed"), true);

    const result = await sendMessage(bindingFor(rec), MESSAGE);

    expect(result).toEqual({ outcome: "failed", error: "binding is closed" });
    expect(rec.sent).toEqual([]);
  });

  it("resolves 'failed' with the stringified value when a non-Error is thrown", async () => {
    const rec = recorder();
    rec.fail = failing("queue is full");

    const result = await sendMessage(bindingFor(rec), MESSAGE);

    expect(result).toEqual({ outcome: "failed", error: "queue is full" });
    expect(rec.sent).toEqual([]);
  });
});

describe("sendOrThrow", () => {
  it("resolves on a successful send", async () => {
    const rec = recorder();

    await expect(sendOrThrow(bindingFor(rec), MESSAGE)).resolves.toBeUndefined();
    expect(rec.sent).toEqual([MESSAGE]);
  });

  it("throws the failure text when the send rejects", async () => {
    const rec = recorder();
    rec.fail = failing(new Error("throttled"));

    await expect(sendOrThrow(bindingFor(rec), MESSAGE)).rejects.toThrow("throttled");
    expect(rec.sent).toEqual([]);
  });

  it("throws the failure text when the binding throws synchronously", async () => {
    const rec = recorder();
    rec.fail = failing(new Error("no such target"), true);

    await expect(sendOrThrow(bindingFor(rec), MESSAGE)).rejects.toThrow("no such target");
    expect(rec.sent).toEqual([]);
  });
});
