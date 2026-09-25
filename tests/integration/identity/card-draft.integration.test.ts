import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";

import { applyDraftIntent, draftKey, readDraft } from "../../../app/lib/identity/card-draft.server";

/**
 * The onboarding card's name/about draft (0509#5238), pinned against the real
 * local KV namespace the workers project provisions from
 * tests/integration/wrangler.test.jsonc. Every edit saves on change and a
 * Back or reload reads the draft instead of losing it; a value that is not a
 * CardDraft-shaped object reads as an empty draft, so a poisoned entry cannot
 * surface a field the form never wrote.
 */
const WORKSPACE = "ws-card-draft";
const REGISTRABLE = "gymshark.com";
const KEY = draftKey(WORKSPACE, REGISTRABLE);

function draftForm(intent: string, fields: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.set("intent", intent);
  form.set("subject", "gymshark.com");
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

describe("identity card draft", () => {
  afterEach(async () => {
    await env.IDENTITY_CACHE.delete(KEY);
  });

  it("reads an unknown workspace and domain as an empty draft", async () => {
    expect(await readDraft("ws-unknown", "unknown.example")).toEqual({});
  });

  it("saves each field without losing the one written before it", async () => {
    await applyDraftIntent(WORKSPACE, draftForm("draft", { field: "name", value: "Gymshark" }));
    await applyDraftIntent(
      WORKSPACE,
      draftForm("draft", { field: "description", value: "Gym wear" }),
    );

    expect(await readDraft(WORKSPACE, REGISTRABLE)).toEqual({
      name: "Gymshark",
      description: "Gym wear",
    });
  });

  it("reads a stored non-object as an empty draft", async () => {
    await env.IDENTITY_CACHE.put(KEY, JSON.stringify(42));

    expect(await readDraft(WORKSPACE, REGISTRABLE)).toEqual({});
  });

  it("clears one field and keeps the other", async () => {
    await applyDraftIntent(WORKSPACE, draftForm("draft", { field: "name", value: "Gymshark" }));
    await applyDraftIntent(
      WORKSPACE,
      draftForm("draft", { field: "description", value: "Gym wear" }),
    );

    await applyDraftIntent(WORKSPACE, draftForm("revert", { field: "name" }));

    expect(await readDraft(WORKSPACE, REGISTRABLE)).toEqual({ description: "Gym wear" });
  });

  it("intent=revert returns true and deletes the KV key when the last field is cleared", async () => {
    await applyDraftIntent(WORKSPACE, draftForm("draft", { field: "name", value: "Gymshark" }));

    expect(await applyDraftIntent(WORKSPACE, draftForm("revert", { field: "name" }))).toBe(true);
    expect(await env.IDENTITY_CACHE.get(KEY)).toBeNull();
  });

  it("applyDraftIntent without a draft intent returns false and writes nothing", async () => {
    const form = new FormData();
    form.set("subject", "gymshark.com");
    form.set("field", "name");
    form.set("value", "Gymshark");

    expect(await applyDraftIntent(WORKSPACE, form)).toBe(false);
    expect(await env.IDENTITY_CACHE.get(KEY)).toBeNull();
  });

  it("applyDraftIntent returns true on a bad field or value, so the route stops there", async () => {
    expect(await applyDraftIntent(WORKSPACE, draftForm("draft", { value: "x" }))).toBe(true);
    expect(
      await applyDraftIntent(WORKSPACE, draftForm("revert", { field: "logo" })),
    ).toBe(true);
    expect(await env.IDENTITY_CACHE.get(KEY)).toBeNull();
  });

  it("applyDraftIntent with intent=draft writes the value through the one public path", async () => {
    const form = new FormData();
    form.set("intent", "draft");
    form.set("subject", "gymshark.com");
    form.set("field", "name");
    form.set("value", "Gymshark");

    expect(await applyDraftIntent(WORKSPACE, form)).toBe(true);
    expect(await readDraft(WORKSPACE, REGISTRABLE)).toEqual({ name: "Gymshark" });
  });
});
