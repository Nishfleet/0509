import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { insertSelfEntity } from "../../../app/lib/data/entity.server";
import { saveDraftField } from "../../../app/lib/identity/card-draft.server";
import { loadIdentityScreen } from "../../../app/lib/identity/identity-screen.server";

const NOW = "2026-09-25T12:00:00.000Z";
const USER_ID = "user-return";
const WORKSPACE_ID = "ws-return";

async function seedWorkspace(): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?3, 1, ?4, ?4)',
  )
    .bind(USER_ID, "Owner", "return@0509.io", NOW)
    .run();
  await env.DB.prepare(
    "INSERT INTO workspace (id, name, owner_user_id, created_at) VALUES (?1, 'Owner', ?2, ?3)",
  )
    .bind(WORKSPACE_ID, USER_ID, NOW)
    .run();
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM entity WHERE workspace_id = ?1").bind(WORKSPACE_ID).run();
  await env.DB.prepare("DELETE FROM workspace WHERE id = ?1").bind(WORKSPACE_ID).run();
  await env.DB.prepare('DELETE FROM "user" WHERE id = ?1').bind(USER_ID).run();
  await seedWorkspace();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadIdentityScreen", () => {
  it("sends a user with no workspace back to the first screen", async () => {
    await env.DB.prepare("DELETE FROM entity WHERE workspace_id = ?1").bind(WORKSPACE_ID).run();
    await env.DB.prepare("DELETE FROM workspace WHERE id = ?1").bind(WORKSPACE_ID).run();

    const request = new Request("https://0509.io/onboarding/identity?subject=gymshark.com");
    try {
      await loadIdentityScreen(request, USER_ID);
      expect.fail("expected a redirect");
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      const response = error as Response;
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/onboarding");
    }
  });

  it("leaves a workspace with no brand on the empty probe path", async () => {
    const screen = await loadIdentityScreen(new Request("https://0509.io/onboarding/identity"), USER_ID);
    expect(screen).toEqual({ card: null, limited: false });
  });

  it("returns the confirmed card on a later visit and does not probe", async () => {
    await insertSelfEntity({
      id: "ent-return",
      workspaceId: WORKSPACE_ID,
      domain: "gymshark.com",
      name: "Returned Gymshark",
      identityJson: JSON.stringify({
        kind: "domain",
        platform: null,
        url: "https://www.gymshark.com/",
        description: "Gym clothes",
        logoUrl: null,
        socials: [{ platform: "instagram", url: "https://www.instagram.com/gymshark/" }],
      }),
      now: NOW,
    });
    await env.SNAPSHOTS.put("logo/gymshark.com", new Uint8Array([1, 2, 3]), {
      httpMetadata: { contentType: "image/png" },
    });
    await saveDraftField(WORKSPACE_ID, "gymshark.com", "name", "Draft Name");

    const calls: string[] = [];
    vi.stubGlobal("fetch", () => {
      calls.push("fetch");
      return Promise.reject(new Error("return visit must not probe"));
    });

    const screen = await loadIdentityScreen(
      new Request("https://0509.io/onboarding/identity?subject=other.example"),
      USER_ID,
    );

    expect(screen.limited).toBe(false);
    expect(screen.card?.domain).toBe("gymshark.com");
    expect(screen.card?.subject).toBe("https://www.gymshark.com/");
    expect(screen.card?.draft.name).toBe("Draft Name");
    expect(await screen.card?.site).toEqual({
      name: "Returned Gymshark",
      description: "Gym clothes",
      socials: [{ platform: "instagram", url: "https://www.instagram.com/gymshark/" }],
      review: { name: "fill", description: "fill", socials: "fill" },
      unfound: false,
    });
    expect(await screen.card?.logo).toBe("data:image/png;base64,AQID");
    expect(calls).toEqual([]);
  });

  it("still shows the saved name when identity_json cannot be read", async () => {
    await insertSelfEntity({
      id: "ent-return-bad",
      workspaceId: WORKSPACE_ID,
      domain: "gymshark.com",
      name: "Kept Name",
      identityJson: "not-json",
      now: NOW,
    });

    const screen = await loadIdentityScreen(
      new Request("https://0509.io/onboarding/identity?subject=gymshark.com"),
      USER_ID,
    );
    expect(await screen.card?.site).toMatchObject({
      name: "Kept Name",
      description: null,
      socials: [],
      unfound: false,
    });
    expect(screen.card?.domain).toBe("gymshark.com");
    expect(screen.card?.subject).toBe("gymshark.com");
  });

  it("shows a saved handle from the stored url", async () => {
    await insertSelfEntity({
      id: "ent-return-handle",
      workspaceId: WORKSPACE_ID,
      domain: "gymshark",
      name: "@gymshark",
      identityJson: JSON.stringify({
        kind: "handle",
        url: null,
        description: null,
        socials: [],
      }),
      now: NOW,
    });

    const screen = await loadIdentityScreen(new Request("https://0509.io/onboarding/identity"), USER_ID);
    expect(screen.card?.domain).toBe("@gymshark");
    expect(screen.card?.subject).toBe("@gymshark");
  });
});
