import { describe, expect, it } from "vitest";

import {
  decryptSlackWebhook,
  encryptSlackWebhook,
  isEncryptedSlackTarget,
} from "../../app/lib/slack-target-crypto.server";

const SECRET = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const OTHER_SECRET = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";
const HOOK = "https://hooks.slack.com/services/T0123ABC/B0456DEF/abcDEF123456";

describe("Slack target AES-GCM", () => {
  it("round-trips a webhook and never stores the URL in the ciphertext", async () => {
    const stored = await encryptSlackWebhook(HOOK, SECRET);
    expect(isEncryptedSlackTarget(stored)).toBe(true);
    expect(stored.startsWith("enc:v1:")).toBe(true);
    expect(stored).not.toContain("hooks.slack.com");
    expect(stored).not.toContain(HOOK);
    expect(await decryptSlackWebhook(stored, SECRET)).toBe(HOOK);
  });

  it("uses a fresh IV so two seals of the same URL differ", async () => {
    const first = await encryptSlackWebhook(HOOK, SECRET);
    const second = await encryptSlackWebhook(HOOK, SECRET);
    expect(first).not.toBe(second);
    expect(await decryptSlackWebhook(first, SECRET)).toBe(HOOK);
    expect(await decryptSlackWebhook(second, SECRET)).toBe(HOOK);
  });

  it("refuses a URL that is not a Slack webhook", async () => {
    await expect(encryptSlackWebhook("https://internal.example/hook", SECRET)).rejects.toThrow(
      "Slack webhook address is not valid",
    );
  });

  it("refuses a secret that is not 32 bytes", async () => {
    await expect(encryptSlackWebhook(HOOK, "c2hvcnQ=")).rejects.toThrow("SLACK_TARGET_SECRET must be 32 bytes");
  });

  it("refuses ciphertext sealed with a different key", async () => {
    const stored = await encryptSlackWebhook(HOOK, SECRET);
    await expect(decryptSlackWebhook(stored, OTHER_SECRET)).rejects.toThrow("Slack target could not be decrypted");
  });

  it("refuses a stored value that is not enc:v1 ciphertext", async () => {
    expect(isEncryptedSlackTarget(HOOK)).toBe(false);
    await expect(decryptSlackWebhook(HOOK, SECRET)).rejects.toThrow("Slack target is not encrypted");
  });

  it("refuses tampered ciphertext", async () => {
    const stored = await encryptSlackWebhook(HOOK, SECRET);
    const smashed = `${stored.slice(0, -2)}aa`;
    await expect(decryptSlackWebhook(smashed, SECRET)).rejects.toThrow("Slack target could not be decrypted");
  });
});
