import { describe, expect, it } from "vitest";

import {
  decryptSlackWebhook,
  encryptSlackWebhook,
  isEncryptedSlackTarget,
} from "../../app/lib/slack-target-crypto.server";

const SECRET = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const OTHER_SECRET = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";
const HOOK = "https://hooks.slack.com/services/T0123ABC/B0456DEF/abcDEF123456";
const WS = "ws-slack-crypto";
const OTHER_WS = "ws-slack-other";

describe("Slack target AES-GCM", () => {
  it("round-trips a webhook and never stores the URL in the ciphertext", async () => {
    const stored = await encryptSlackWebhook(HOOK, SECRET, WS);
    expect(isEncryptedSlackTarget(stored)).toBe(true);
    expect(stored.startsWith("enc:v1:")).toBe(true);
    expect(stored).not.toContain("hooks.slack.com");
    expect(stored).not.toContain(HOOK);
    expect(await decryptSlackWebhook(stored, SECRET, WS)).toBe(HOOK);
  });

  it("uses a fresh IV so two seals of the same URL differ", async () => {
    const first = await encryptSlackWebhook(HOOK, SECRET, WS);
    const second = await encryptSlackWebhook(HOOK, SECRET, WS);
    expect(first).not.toBe(second);
    expect(await decryptSlackWebhook(first, SECRET, WS)).toBe(HOOK);
    expect(await decryptSlackWebhook(second, SECRET, WS)).toBe(HOOK);
  });

  it("refuses a URL that is not a Slack webhook", async () => {
    await expect(encryptSlackWebhook("https://internal.example/hook", SECRET, WS)).rejects.toThrow(
      "Slack webhook address is not valid",
    );
  });

  it("refuses a secret that is not 32 bytes", async () => {
    await expect(encryptSlackWebhook(HOOK, "c2hvcnQ=", WS)).rejects.toThrow("SLACK_TARGET_SECRET must be 32 bytes");
  });

  it("refuses ciphertext sealed with a different key", async () => {
    const stored = await encryptSlackWebhook(HOOK, SECRET, WS);
    await expect(decryptSlackWebhook(stored, OTHER_SECRET, WS)).rejects.toThrow("Slack target could not be decrypted");
  });

  it("refuses ciphertext bound to a different workspace", async () => {
    const stored = await encryptSlackWebhook(HOOK, SECRET, WS);
    await expect(decryptSlackWebhook(stored, SECRET, OTHER_WS)).rejects.toThrow("Slack target could not be decrypted");
  });

  it("refuses a stored value that is not enc:v1 ciphertext", async () => {
    expect(isEncryptedSlackTarget(HOOK)).toBe(false);
    await expect(decryptSlackWebhook(HOOK, SECRET, WS)).rejects.toThrow("Slack target is not encrypted");
  });

  it("refuses tampered ciphertext", async () => {
    const stored = await encryptSlackWebhook(HOOK, SECRET, WS);
    const smashed = `${stored.slice(0, -2)}aa`;
    await expect(decryptSlackWebhook(smashed, SECRET, WS)).rejects.toThrow("Slack target could not be decrypted");
  });

  it("refuses a payload shorter than IV plus GCM tag", async () => {
    await expect(decryptSlackWebhook("enc:v1:AAAAAAAAAAAA", SECRET, WS)).rejects.toThrow(
      "Slack target could not be decrypted",
    );
  });
});
