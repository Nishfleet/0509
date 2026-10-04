import { describe, expect, it } from "vitest";

import { classifyJevFailure, MESSAGE_MAX } from "../../app/lib/jev/failure";

describe("classifyJevFailure", () => {
  it("calls Clef's 2003 a rate limit and keeps the code", () => {
    expect(classifyJevFailure(new Error("jev unavailable: 2003: Rate limited"))).toEqual({
      kind: "rate_limited",
      code: "2003",
      message: "2003: Rate limited",
    });
  });

  it("calls a payment or quota refusal billing, ahead of every other kind", () => {
    expect(classifyJevFailure(new Error("2021: Payment error")).kind).toBe("billing");
    expect(classifyJevFailure(new Error("you have used up your daily free allocation")).kind).toBe("billing");
  });

  it("calls an answer that does not parse a bad shape", () => {
    const failure = classifyJevFailure(new Error("answer missing its noul; keys=a,b; issues=answers:invalid_type"));

    expect(failure.kind).toBe("bad_shape");
    expect(failure.code).toBeNull();
  });

  it("calls a timeout a timeout and anything else other", () => {
    expect(classifyJevFailure(new Error("The operation timed out")).kind).toBe("timeout");
    expect(classifyJevFailure(new Error("Network connection lost")).kind).toBe("other");
    expect(classifyJevFailure("plain text failure").kind).toBe("other");
  });

  it("keeps one trimmed line of at most the message limit", () => {
    const failure = classifyJevFailure(new Error(`line one\n\n   line two ${"x".repeat(400)}`));

    expect(failure.message.startsWith("line one line two x")).toBe(true);
    expect(failure.message).toHaveLength(MESSAGE_MAX);
  });
});
