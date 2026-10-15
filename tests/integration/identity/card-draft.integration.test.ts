import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyDraftIntent,
  clearDraftField,
  draftKey,
  readDraft,
  saveDraftField,
} from "../../../app/lib/identity/card-draft.server";

const WORKSPACE = "ws-card-draft";
const REGISTRABLE = "gymshark.com";
const KEY = draftKey(WORKSPACE, REGISTRABLE);

describe("identity card draft", () => {
  afterEach(async () => {
    await env.IDENTITY_CACHE.delete(KEY);
  });

  it("reads an unknown workspace and domain as an empty draft", async () => {
    expect(await readDraft("ws-unknown", "unknown.example")).toEqual({});
  });

  it("saves each field without losing the one written before it", async () => {
    await saveDraftField(WORKSPACE, REGISTRABLE, { field: "name", value: "Gymshark" });
    await saveDraftField(WORKSPACE, REGISTRABLE, { field: "description", value: "Gym wear" });

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
    await saveDraftField(WORKSPACE, REGISTRABLE, { field: "name", value: "Gymshark" });
    await saveDraftField(WORKSPACE, REGISTRABLE, { field: "description", value: "Gym wear" });

    await clearDraftField(WORKSPACE, REGISTRABLE, "name");

    expect(await readDraft(WORKSPACE, REGISTRABLE)).toEqual({ description: "Gym wear" });
  });

  it("clears the last field by deleting the KV key", async () => {
    await saveDraftField(WORKSPACE, REGISTRABLE, { field: "name", value: "Gymshark" });

    await clearDraftField(WORKSPACE, REGISTRABLE, "name");

    expect(await env.IDENTITY_CACHE.get(KEY)).toBeNull();
  });

  it("reverts a field through the route's one intent path", async () => {
    await saveDraftField(WORKSPACE, REGISTRABLE, { field: "name", value: "Gymshark" });
    await saveDraftField(WORKSPACE, REGISTRABLE, { field: "description", value: "Gym wear" });
    const form = new FormData();
    form.set("intent", "revert");
    form.set("subject", "gymshark.com");
    form.set("field", "name");

    expect(await applyDraftIntent(WORKSPACE, form)).toBe(true);
    expect(await readDraft(WORKSPACE, REGISTRABLE)).toEqual({ description: "Gym wear" });
  });

  it("ignores a form with no draft intent and writes nothing", async () => {
    const form = new FormData();
    form.set("subject", "gymshark.com");
    form.set("field", "name");
    form.set("value", "Gymshark");

    expect(await applyDraftIntent(WORKSPACE, form)).toBe(false);
    expect(await env.IDENTITY_CACHE.get(KEY)).toBeNull();
  });
});
