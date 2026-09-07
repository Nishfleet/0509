import { describe, expect, it } from "vitest";

import {
  AgentMemoryInputError,
  readSafeAgentMemoryKey,
  readSafeAgentMemorySource,
  readSafeAgentMemoryValue,
  safeAgentMemoryRecord,
  summarizeAgentMemoryValue,
} from "~/lib/agent-memory.server";

describe("agent memory input safety", () => {
  const liveKey = ["f9", "live", "secret"].join("_");
  const passwordAssignment = ["password", "hunter2"].join("=");
  const dodoApiKeyAssignment = [["DODO", "API", "KEY"].join("_"), "dodo_secret_123"].join("=");
  const githubToken = ["ghp", "abcdefghijklmnopqrstuvwxyz"].join("_");
  const bearerToken = [["Authorization:", "Bearer"].join(" "), `eyJ${"hbGciOiJIUzI1NiJ9.fake"}`].join(" ");
  const privateKeyHeader = ["-----BEGIN", "PRIVATE", "KEY-----"].join(" ");
  const privateKey = [privateKeyHeader, "abc", privateKeyHeader.replace("BEGIN", "END")].join("\n");
  const bareSlackWebhook = "hooks.slack.com/services/T/B/C";
  const discordWebhook = "https://discord.com/api/webhooks/1234567890/discord_webhook_secret";
  const teamsWebhook = "https://example.webhook.office.com/webhookb2/tenant/incoming-webhook/token";
  const zapierWebhook = "https://hooks.zapier.com/hooks/catch/123456/abcdef";
  const stripeSecret = ["sk", "live", "1234567890abcdefghijkl"].join("_");
  const stripeRestricted = ["rk", "live", "1234567890abcdefghijkl"].join("_");
  const stripeWebhookSecret = ["whsec", "1234567890abcdefghijkl"].join("_");
  const awsAccessKey = ["AK", "IA", "ABCDEFGHIJKLMNOP"].join("");
  const googleApiKey = ["AI", "za", "A".repeat(35)].join("");
  const opaqueToken = ["AbcdefGHIJK", "1234567890", "mnopqrstuvwxyzABCDE"].join("");
  const jwt = [
    `eyJ${"hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"}`,
    "eyJzdWIiOiIxMjM0NTY3ODkwIn0",
    "mocksignaturevalue",
  ].join(".");

  it("normalizes safe text memory into stored JSON", () => {
    expect(readSafeAgentMemoryValue("Weekly review, direct tone.")).toEqual({
      value: "Weekly review, direct tone.",
    });
  });

  it("preserves safe structured memory and array memory", () => {
    expect(readSafeAgentMemoryValue({ tone: "direct", cadence: "weekly" })).toEqual({
      tone: "direct",
      cadence: "weekly",
    });
    expect(readSafeAgentMemoryValue(["weekly", { owner: "growth" }])).toEqual({
      items: ["weekly", { owner: "growth" }],
    });
  });

  it("rejects secret-like keys, sources, fields, and values", () => {
    expect(() => readSafeAgentMemoryKey("api_token")).toThrow(AgentMemoryInputError);
    expect(() => readSafeAgentMemoryKey(liveKey)).toThrow(AgentMemoryInputError);
    expect(() => readSafeAgentMemorySource("slack_webhook")).toThrow(AgentMemoryInputError);
    expect(() => readSafeAgentMemorySource(`owner ${githubToken}`)).toThrow(AgentMemoryInputError);
    expect(() => readSafeAgentMemoryValue({ apiKey: "do-not-store" })).toThrow(AgentMemoryInputError);
    expect(() => readSafeAgentMemoryValue({ [liveKey]: "do-not-store" })).toThrow(AgentMemoryInputError);
    expect(() => readSafeAgentMemoryValue("https://hooks.slack.com/services/T/B/C")).toThrow(AgentMemoryInputError);
    expect(() => readSafeAgentMemoryValue(bareSlackWebhook)).toThrow(AgentMemoryInputError);
    expect(() => readSafeAgentMemoryValue(`API key: ${liveKey}`)).toThrow(AgentMemoryInputError);
    expect(() => readSafeAgentMemoryValue(passwordAssignment)).toThrow(AgentMemoryInputError);
    expect(() => readSafeAgentMemoryValue(dodoApiKeyAssignment)).toThrow(AgentMemoryInputError);
    expect(() => readSafeAgentMemoryValue(`GitHub token ${githubToken}`)).toThrow(AgentMemoryInputError);
    expect(() => readSafeAgentMemoryValue(bearerToken)).toThrow(AgentMemoryInputError);
    expect(() => readSafeAgentMemoryValue(privateKey)).toThrow(AgentMemoryInputError);
    expect(() => readSafeAgentMemoryValue(jwt)).toThrow(AgentMemoryInputError);
    expect(() => readSafeAgentMemoryValue(`{"apiKey":"${liveKey}"}`)).toThrow(AgentMemoryInputError);
    expect(() => readSafeAgentMemoryValue(`{"delivery":{"webhookUrl":"${discordWebhook}"}}`)).toThrow(AgentMemoryInputError);
    expect(() => readSafeAgentMemoryValue(discordWebhook)).toThrow(AgentMemoryInputError);
    expect(() => readSafeAgentMemoryValue(teamsWebhook)).toThrow(AgentMemoryInputError);
    expect(() => readSafeAgentMemoryValue(zapierWebhook)).toThrow(AgentMemoryInputError);
    expect(() => readSafeAgentMemoryValue(stripeSecret)).toThrow(AgentMemoryInputError);
    expect(() => readSafeAgentMemoryValue(stripeRestricted)).toThrow(AgentMemoryInputError);
    expect(() => readSafeAgentMemoryValue(stripeWebhookSecret)).toThrow(AgentMemoryInputError);
    expect(() => readSafeAgentMemoryValue(awsAccessKey)).toThrow(AgentMemoryInputError);
    expect(() => readSafeAgentMemoryValue(googleApiKey)).toThrow(AgentMemoryInputError);
    expect(() => readSafeAgentMemoryValue(opaqueToken)).toThrow(AgentMemoryInputError);
    expect(() => readSafeAgentMemoryValue("550e8400-e29b-41d4-a716-446655440000")).not.toThrow();
  });

  it("summarizes legacy secret-looking scalar values without exposing them", () => {
    expect(summarizeAgentMemoryValue({ value: "https://hooks.slack.com/services/T/B/C" })).toBe("[redacted]");
    expect(summarizeAgentMemoryValue({ value: bareSlackWebhook })).toBe("[redacted]");
    expect(summarizeAgentMemoryValue({ value: `API key: ${liveKey}` })).toBe("[redacted]");
    expect(summarizeAgentMemoryValue({ value: passwordAssignment })).toBe("[redacted]");
    expect(summarizeAgentMemoryValue({ value: `GitHub token ${githubToken}` })).toBe("[redacted]");
    expect(summarizeAgentMemoryValue({ value: `{"apiKey":"${liveKey}"}` })).toBe("[redacted]");
    expect(summarizeAgentMemoryValue({ value: discordWebhook })).toBe("[redacted]");
    expect(summarizeAgentMemoryValue({ value: teamsWebhook })).toBe("[redacted]");
    expect(summarizeAgentMemoryValue({ value: zapierWebhook })).toBe("[redacted]");
    expect(summarizeAgentMemoryValue({ value: stripeSecret })).toBe("[redacted]");
    expect(summarizeAgentMemoryValue({ value: awsAccessKey })).toBe("[redacted]");
    expect(summarizeAgentMemoryValue({ value: googleApiKey })).toBe("[redacted]");
    expect(summarizeAgentMemoryValue({ value: opaqueToken })).toBe("[redacted]");
    expect(summarizeAgentMemoryValue({ tone: "direct", cadence: "weekly" })).toBe("Fields: tone, cadence");
  });

  it("redacts legacy secret-looking safe records before agent or UI use", () => {
    const record = safeAgentMemoryRecord({
      id: "memory-1",
      userId: "user-1",
      scope: "workspace",
      key: liveKey,
      watchlistId: null,
      clientRoomId: null,
      value: {
        value: `API key: ${liveKey}`,
        nested: {
          [githubToken]: "do-not-store",
          tone: "direct",
        },
      },
      source: `owner ${githubToken}`,
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z",
    });

    expect(record.key).toBe("[redacted]");
    expect(record.value).toEqual({
      value: "[redacted]",
      nested: {
        "[redacted]": "[redacted]",
        tone: "direct",
      },
    });
    expect(record.source).toBeNull();
  });
});
