import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { classifyNavPages, PAGE_ROLE } from "../../../app/lib/identity/page-role.server";

const NOW = "2026-09-24T12:00:00.000Z";

const PAGE_URL = "https://www.gymshark.com/collections/all-products";

const PAGE = { url: PAGE_URL, title: "All Products" };

const ENTITY = { id: "e-page-role", domain: "gymshark.com" };

let workspaceId: string;
let runs = 0;

async function seed(): Promise<void> {
  runs += 1;
  const userId = `u-page-role-${String(runs)}`;
  workspaceId = `ws-page-role-${String(runs)}`;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM page"),
    env.DB.prepare("DELETE FROM jev_verdict"),
    env.DB.prepare("DELETE FROM entity"),
    env.DB.prepare('DELETE FROM workspace WHERE id = ?1').bind(workspaceId),
    env.DB.prepare('DELETE FROM "user" WHERE id = ?1').bind(userId),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?3, 0, ?4, ?4)',
    ).bind(userId, "Owner", `${userId}@0509.io`, NOW),
    env.DB.prepare("INSERT INTO workspace (id, name, owner_user_id, created_at) VALUES (?1, 'Gymshark', ?2, ?3)").bind(
      workspaceId,
      userId,
      NOW,
    ),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, origin, state, created_at) VALUES (?1, ?2, 'self', 'gymshark.com', 'Gymshark', '{}', 'manual', 'on', ?3)",
    ).bind(ENTITY.id, workspaceId, NOW),
  ]);
}

async function readPages(): Promise<Record<string, unknown>[]> {
  const { results } = await env.DB.prepare(
    "SELECT entity_id, url, title, role, role_decided_for_hash FROM page",
  ).all();
  return results;
}

afterEach(() => {
  Reflect.deleteProperty(env, "AI");
});

describe("classifyNavPages", () => {
  beforeEach(seed);

  it("asks Jev once per page and writes the judged page with its decision hash", async () => {
    const run = vi.fn(() =>
      Promise.resolve({ answers: { page_role: { type: "choice", choice: "pricing" } } }),
    );
    Reflect.set(env, "AI", { run });

    const rows = await classifyNavPages(workspaceId, ENTITY, [PAGE], NOW);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entityId: ENTITY.id,
      url: PAGE_URL,
      title: "All Products",
      role: "pricing",
      roleDecidedForHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      discoveredAt: NOW,
    });

    const pages = await readPages();
    expect(pages).toEqual([
      {
        entity_id: ENTITY.id,
        url: PAGE_URL,
        title: "All Products",
        role: "pricing",
        role_decided_for_hash: rows[0]?.roleDecidedForHash,
      },
    ]);

    expect(run).toHaveBeenCalledTimes(1);
    const request = run.mock.calls[0]?.[1] as { questions: { page_role: { type: string; criteria: unknown } } };
    expect(request.questions.page_role.type).toBe("choice");
    expect(request.questions.page_role.criteria).toEqual(PAGE_ROLE.options);
  });

  it("leaves an unchanged page alone and asks Jev nothing more", async () => {
    const run = vi.fn(() =>
      Promise.resolve({ answers: { page_role: { type: "choice", choice: "pricing" } } }),
    );
    Reflect.set(env, "AI", { run });

    await classifyNavPages(workspaceId, ENTITY, [PAGE], NOW);
    const second = await classifyNavPages(workspaceId, ENTITY, [PAGE], "2026-09-25T12:00:00.000Z");

    expect(second).toEqual([]);
    expect(run).toHaveBeenCalledTimes(1);
    const pages = await readPages();
    expect(pages).toHaveLength(1);
    expect(pages[0]?.role).toBe("pricing");
  });

  it("re-judges a page whose title changed and rewrites the one row", async () => {
    const run = vi.fn(() =>
      Promise.resolve({ answers: { page_role: { type: "choice", choice: "pricing" } } }),
    );
    Reflect.set(env, "AI", { run });
    await classifyNavPages(workspaceId, ENTITY, [PAGE], NOW);
    const firstHash = (await readPages())[0]?.role_decided_for_hash;

    Reflect.deleteProperty(env, "AI");
    const secondRun = vi.fn(() =>
      Promise.resolve({ answers: { page_role: { type: "choice", choice: "other" } } }),
    );
    Reflect.set(env, "AI", { run: secondRun });

    const second = await classifyNavPages(workspaceId, ENTITY, [{ url: PAGE_URL, title: "Sale" }], NOW);

    expect(secondRun).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(second).toEqual([
      {
        id: expect.any(String),
        entityId: ENTITY.id,
        url: PAGE_URL,
        title: "Sale",
        role: "other",
        roleDecidedForHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        discoveredAt: NOW,
      },
    ]);
    const pages = await readPages();
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ url: PAGE_URL, title: "Sale", role: "other" });
    expect(pages[0]?.role_decided_for_hash).not.toBe(firstHash);
  });

  it("asks the D9 page_role choice with its seven roles", () => {
    expect(PAGE_ROLE).toEqual({
      id: "page_role",
      instructions:
        "What is item for on the site of subject? Judge by what the page is for, not by the words in its URL.",
      options: {
        home: "the site's front page",
        pricing: "plans, prices, or the full catalogue a buyer compares prices on",
        product: "a single product or product line",
        blog: "articles, news or journal posts",
        careers: "jobs or working at the company",
        legal: "terms, privacy, cookies or returns policy",
        other: "anything else",
      },
    });
  });

  it("logs one uncached verdict per judged page and writes the page rows in one batch", async () => {
    const run = vi.fn(() =>
      Promise.resolve({ answers: { page_role: { type: "choice", choice: "blog" } } }),
    );
    Reflect.set(env, "AI", { run });

    await classifyNavPages(
      workspaceId,
      ENTITY,
      [
        PAGE,
        { url: "https://www.gymshark.com/blogs/news/introducing-adapt", title: "Adapt" },
      ],
      NOW,
    );

    const { results } = await env.DB.prepare(
      "SELECT question_id, choice, entity_id, p, signal_id, reason, decided_at, workspace_id FROM jev_verdict",
    ).all();
    expect(results).toHaveLength(2);
    for (const row of results) {
      expect(row).toMatchObject({
        question_id: "page_role",
        choice: "blog",
        entity_id: ENTITY.id,
        p: null,
        signal_id: null,
        reason: null,
        decided_at: NOW,
        workspace_id: workspaceId,
      });
    }
    expect(run).toHaveBeenCalledTimes(2);
    expect(await readPages()).toHaveLength(2);
  });

  it("writes nothing and propagates JevUnavailableError when Jev refuses", async () => {
    const run = vi.fn(() => Promise.reject(new Error("jev down")));
    Reflect.set(env, "AI", { run });

    await expect(classifyNavPages(workspaceId, ENTITY, [PAGE], NOW)).rejects.toThrow(
      /^jev unavailable: jev down$/,
    );
    expect(await readPages()).toEqual([]);
    const { results } = await env.DB.prepare("SELECT id FROM jev_verdict").all();
    expect(results).toHaveLength(0);
  });
});
