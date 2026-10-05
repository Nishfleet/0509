import { describe, expect, it } from "vitest";

import {
  decryptSlackWebhook,
  decryptSlackWebhookWithKeys,
  encryptSlackWebhook,
  isEncryptedSlackTarget,
  isSealedWithKey,
  slackTargetKeyId,
} from "../../app/lib/slack-target-crypto.server";

const SECRET = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const PREVIOUS = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";
const OTHER_SECRET = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";
const HOOK = "https://hooks.slack.com/services/T0123ABC/B0456DEF/abcDEF123456";
const WS = "ws-slack-crypto";
const OTHER_WS = "ws-slack-other";

describe("Slack target AES-GCM", () => {
  it("round-trips a webhook and never stores the URL in the ciphertext", async () => {
    const stored = await encryptSlackWebhook(HOOK, SECRET, WS);
    expect(isEncryptedSlackTarget(stored)).toBe(true);
    expect(stored.startsWith("enc:v2:")).toBe(true);
    const keyId = stored.slice("enc:v2:".length, "enc:v2:".length + 16);
    expect(keyId).toBe(await slackTargetKeyId(SECRET));
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

  it("refuses a stored value that is not enc ciphertext", async () => {
    expect(isEncryptedSlackTarget(HOOK)).toBe(false);
    await expect(decryptSlackWebhook(HOOK, SECRET, WS)).rejects.toThrow("Slack target is not encrypted");
  });

  it("still reads a legacy enc:v1 row, which carries no key id", async () => {
    const stored = await encryptSlackWebhook(HOOK, SECRET, WS);
    const legacy = `enc:v1:${stored.split(":")[3] ?? ""}`;
    expect(await decryptSlackWebhook(legacy, SECRET, WS)).toBe(HOOK);
    expect(await isSealedWithKey(legacy, SECRET)).toBe(false);
  });

  it("reads a row sealed with the previous key while the new key is first in the list", async () => {
    const stored = await encryptSlackWebhook(HOOK, PREVIOUS, WS);
    expect(await decryptSlackWebhookWithKeys(stored, [SECRET, PREVIOUS], WS)).toBe(HOOK);
    expect(await isSealedWithKey(stored, PREVIOUS)).toBe(true);
    expect(await isSealedWithKey(stored, SECRET)).toBe(false);
  });

  it("refuses a row whose key is no longer in the list", async () => {
    const stored = await encryptSlackWebhook(HOOK, PREVIOUS, WS);
    await expect(decryptSlackWebhookWithKeys(stored, [SECRET], WS)).rejects.toThrow(
      "Slack target could not be decrypted",
    );
    await expect(decryptSlackWebhookWithKeys(stored, [], WS)).rejects.toThrow("Slack target could not be decrypted");
  });

  it("refuses an enc:v2 row whose key id names another key, without trying it", async () => {
    const stored = await encryptSlackWebhook(HOOK, SECRET, WS);
    const relabelled = stored.replace(await slackTargetKeyId(SECRET), await slackTargetKeyId(PREVIOUS));
    await expect(decryptSlackWebhook(relabelled, SECRET, WS)).rejects.toThrow("Slack target could not be decrypted");
  });

  it("refuses a payload shorter than IV plus GCM tag", async () => {
    await expect(decryptSlackWebhook("enc:v2:AAAAAAAAAAAAAAAA:AA", SECRET, WS)).rejects.toThrow(
      "Slack target could not be decrypted",
    );
  });

  it("refuses tampered ciphertext", async () => {
    const stored = await encryptSlackWebhook(HOOK, SECRET, WS);
    const smashed = `${stored.slice(0, -2)}aa`;
    await expect(decryptSlackWebhook(smashed, SECRET, WS)).rejects.toThrow("Slack target could not be decrypted");
  });
});
