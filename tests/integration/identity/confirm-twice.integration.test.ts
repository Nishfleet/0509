import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { confirmCard } from "../../../app/lib/identity/confirm.server";
import { normaliseSubject } from "../../../app/lib/identity/normalise";
import { probeKey } from "../../../app/lib/identity/probe-cache.server";

const NOW = "2026-09-25T10:30:00Z";
const DOMAIN = "acme-widgets.com";
const HOMEPAGE_HTML = `<html><head><title>Acme Widgets</title></head><body>${"Acme Widgets makes widgets for everyone. ".repeat(4)}</body></html>`;

let userId = "";
let workspaceId = "";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

function homepageKey(): string {
  const normalised = normaliseSubject(DOMAIN);
  if (!normalised.ok) throw new Error("the domain must normalise");
  return probeKey(normalised.subject, "homepage");
}

beforeEach(async () => {
  await env.IDENTITY_CACHE.put(
    homepageKey(),
    JSON.stringify({
      name: "Acme Widgets",
      description: "widgets",
      socials: [],
      logoCandidates: { ldOrganizationLogo: null, ogImage: null, appleTouchIcon: null },
      adLibraryHints: [],
      navLinks: [],
    }),
  );
  for (const table of ["user_decision", "entity", "workspace", '"user"']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  const suffix = crypto.randomUUID();
  userId = `user-confirm-twice-${suffix}`;
  workspaceId = `ws-confirm-twice-${suffix}`;
  Reflect.set(env, "DISCOVERY", { createBatch: vi.fn(() => Promise.resolve([])) });
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === `https://${DOMAIN}/`) {
      return Promise.resolve(new Response(HOMEPAGE_HTML, { status: 200, headers: { "content-type": "text/html" } }));
    }
    return Promise.resolve(new Response("", { status: 200 }));
  });
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, 'Owner', ?2, 0, ?3, ?3)`,
  )
    .bind(userId, `${userId}@0509.io`, NOW)
    .run();
  await env.DB.prepare(`INSERT INTO workspace (id, name, owner_user_id, created_at) VALUES (?1, 'Owner', ?2, ?3)`)
    .bind(workspaceId, userId, NOW)
    .run();
});

afterEach(() => {
  Reflect.deleteProperty(env, "DISCOVERY");
  vi.unstubAllGlobals();
});

async function selfRows(): Promise<{ id: string; name: string; identity_json: string }[]> {
  const { results } = await env.DB.prepare(
    "SELECT id, name, identity_json FROM entity WHERE workspace_id = ?1 AND role = 'self'",
  )
    .bind(workspaceId)
    .all<{ id: string; name: string; identity_json: string }>();
  return results;
}

async function settledTail(): Promise<void> {
  const [row] = await selfRows();
  if (row === undefined) return;
  const instance = await env.IDENTITY_TAIL.get(`identity-tail-${row.id}`);
  if (instance === null) return;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const status = await instance.status();
    if (status.status === "complete" || status.status === "errored") return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("identity tail did not finish");
}

describe("confirming the identity card twice", () => {
  it("keeps one self entity and lets the second name and about win", async () => {
    expect(
      await confirmCard(workspaceId, userId, form({ subject: DOMAIN, name: "Junk", description: "first line" })),
    ).toBe(true);
    await settledTail();
    expect(
      await confirmCard(
        workspaceId,
        userId,
        form({ subject: DOMAIN, name: "Acme Widgets", description: "second line" }),
      ),
    ).toBe(true);
    await settledTail();

    const rows = await selfRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Acme Widgets");
    const identity = JSON.parse(rows[0]?.identity_json ?? "{}") as { description: string };
    expect(identity.description).toBe("second line");
  });

  it("points the logo at the entity that survives the second confirm", async () => {
    await env.SNAPSHOTS.put(`logo/v3/${DOMAIN}`, new Uint8Array([1, 2, 3]), {
      httpMetadata: { contentType: "image/png" },
    });
    await confirmCard(workspaceId, userId, form({ subject: DOMAIN, name: "Junk", description: "" }));
    await settledTail();
    await confirmCard(workspaceId, userId, form({ subject: DOMAIN, name: "Acme Widgets", description: "" }));
    await settledTail();

    const [row] = await selfRows();
    const identity = JSON.parse(row?.identity_json ?? "{}") as { logoUrl: string | null };
    expect(identity.logoUrl).toBe(`/app/logos/${row?.id ?? ""}`);
  });
});
