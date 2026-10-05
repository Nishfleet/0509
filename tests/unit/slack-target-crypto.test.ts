import { describe, expect, it } from "vitest";

import {
  decryptSlackWebhook,
  decryptSlackWebhookWithKeys,
  encryptSlackWebhook,
  isEncryptedSlackTarget,
  isSealedWithKey,
  parseSlackTargetKeys,
} from "../../app/lib/slack-target-crypto.server";

const SECRET = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const OTHER_SECRET = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";
const HOOK = "https://hooks.slack.com/services/T0123ABC/B0456DEF/abcDEF123456";
const WS = "ws-slack-crypto";
const OTHER_WS = "ws-slack-other";
const THIRD_SECRET = "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=";
const FOURTH_SECRET = "AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM=";

const asV1 = (v2: string) => `enc:v1:${v2.split(":").slice(3).join(":")}`;

describe("Slack target AES-GCM", () => {
  it("round-trips a webhook and never stores the URL in the ciphertext", async () => {
    const stored = await encryptSlackWebhook(HOOK, SECRET, WS);
    expect(isEncryptedSlackTarget(stored)).toBe(true);
    expect(stored.startsWith("enc:v2:")).toBe(true);
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

  it("names the sealing key in the stored prefix without exposing the key", async () => {
    const stored = await encryptSlackWebhook(HOOK, SECRET, WS);
    expect(stored).not.toContain(SECRET);
    expect(await isSealedWithKey(stored, SECRET)).toBe(true);
    expect(await isSealedWithKey(stored, OTHER_SECRET)).toBe(false);
  });

  it("still decrypts an enc:v1 row, which names no key", async () => {
    const legacy = asV1(await encryptSlackWebhook(HOOK, SECRET, WS));
    expect(await isSealedWithKey(legacy, SECRET)).toBe(false);
    expect(await decryptSlackWebhookWithKeys(legacy, [OTHER_SECRET, SECRET], WS)).toBe(HOOK);
  });

  it("decrypts with the previous key when the current key is listed first", async () => {
    const stored = await encryptSlackWebhook(HOOK, OTHER_SECRET, WS);
    expect(await decryptSlackWebhookWithKeys(stored, [SECRET, OTHER_SECRET], WS)).toBe(HOOK);
  });

  it("fails generically when no listed key opens the row or the list is empty", async () => {
    const stored = await encryptSlackWebhook(HOOK, THIRD_SECRET, WS);
    await expect(decryptSlackWebhookWithKeys(stored, [SECRET, OTHER_SECRET], WS)).rejects.toThrow(
      "Slack target could not be decrypted",
    );
    await expect(decryptSlackWebhookWithKeys(stored, [], WS)).rejects.toThrow("Slack target could not be decrypted");
  });

  it("refuses the wrong workspace across a key list", async () => {
    const stored = await encryptSlackWebhook(HOOK, SECRET, WS);
    await expect(decryptSlackWebhookWithKeys(stored, [SECRET, OTHER_SECRET], OTHER_WS)).rejects.toThrow(
      "Slack target could not be decrypted",
    );
  });

  it("does not echo key material in any error", async () => {
    const stored = await encryptSlackWebhook(HOOK, SECRET, WS);
    const failure = await decryptSlackWebhookWithKeys(stored, [OTHER_SECRET], WS).catch(
      (error: Error) => error.message,
    );
    expect(failure).not.toContain(SECRET);
    expect(failure).not.toContain(OTHER_SECRET);
    expect(failure).not.toContain(HOOK);
  });
});

describe("SLACK_TARGET_SECRET key list", () => {
  it("parses one key, and up to three in order", async () => {
    expect(await parseSlackTargetKeys(SECRET)).toEqual([SECRET]);
    expect(await parseSlackTargetKeys(` ${SECRET} , ${OTHER_SECRET},${THIRD_SECRET}`)).toEqual([
      SECRET,
      OTHER_SECRET,
      THIRD_SECRET,
    ]);
  });

  it("refuses more than three keys", async () => {
    await expect(parseSlackTargetKeys([SECRET, OTHER_SECRET, THIRD_SECRET, FOURTH_SECRET].join(","))).rejects.toThrow(
      "SLACK_TARGET_SECRET is not configured",
    );
  });

  it("fails closed on an empty list, an empty key, or a missing value", async () => {
    for (const raw of ["", "   ", `${SECRET},`, `,${SECRET}`, `${SECRET},,${OTHER_SECRET}`, undefined, 7]) {
      await expect(parseSlackTargetKeys(raw)).rejects.toThrow("SLACK_TARGET_SECRET is not configured");
    }
  });

  it("fails closed when any key in the list is malformed, in any position", async () => {
    const short = "AAAA";
    const notBase64 = "!!!not-base64!!!";
    for (const bad of [short, notBase64]) {
      for (const raw of [bad, `${SECRET},${bad}`, `${bad},${SECRET}`, `${SECRET},${bad},${OTHER_SECRET}`]) {
        await expect(parseSlackTargetKeys(raw)).rejects.toThrow("SLACK_TARGET_SECRET must be 32 bytes");
      }
    }
  });
});
