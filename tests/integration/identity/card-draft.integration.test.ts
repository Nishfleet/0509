import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";

import {
  draftKey,
  readDraft,
  saveDraftField,
} from "../../../app/lib/identity/card-draft.server";

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

describe("identity card draft", () => {
  afterEach(async () => {
    await env.IDENTITY_CACHE.delete(KEY);
  });

  it("keys draft:<workspace>:<registrable>", () => {
    expect(KEY).toBe("draft:ws-card-draft:gymshark.com");
  });

  it("reads an unknown workspace and domain as an empty draft", async () => {
    expect(await readDraft("ws-unknown", "unknown.example")).toEqual({});
  });

  it("saves each field without losing the one written before it", async () => {
    await saveDraftField(WORKSPACE, REGISTRABLE, "name", "Gymshark");
    await saveDraftField(WORKSPACE, REGISTRABLE, "description", "Gym wear");

    expect(await readDraft(WORKSPACE, REGISTRABLE)).toEqual({
      name: "Gymshark",
      description: "Gym wear",
    });
  });

  it("reads a stored non-object as an empty draft", async () => {
    await env.IDENTITY_CACHE.put(KEY, JSON.stringify(42));

    expect(await readDraft(WORKSPACE, REGISTRABLE)).toEqual({});
  });
});
