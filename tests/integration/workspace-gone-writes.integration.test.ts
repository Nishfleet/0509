// 0509#6009: an account deleted while an onboarding request is in flight took
// the workspace with it (workspace.owner_user_id cascades), and the verdict and
// decision writes that followed failed on the workspace foreign key. Sentry
// captured the same D1_ERROR: FOREIGN KEY constraint failed out of
// screenPublicSubject / screenOnboardingSubject.
import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { insertSubjectDecision, insertFieldEdits, readSubjectDecision } from "../../app/lib/data/user_decision.server";
import { screenPublicSubject } from "../../app/lib/jev/public-subject.server";
import { screenOnboardingSubject } from "../../app/lib/onboarding-screen.server";

const NOW = "2026-09-29T06:00:00.000Z";

let runs = 0;

async function seedWorkspace(): Promise<{ userId: string; workspaceId: string }> {
  runs += 1;
  const userId = `user-ws-gone-${String(runs)}`;
  const workspaceId = `ws-gone-${String(runs)}`;
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?2, 1, ?3, ?3)',
    ).bind(userId, `${userId}@example.com`, NOW),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Gymshark', ?2, 'UTC', 1, 8, ?3)",
    ).bind(workspaceId, userId, NOW),
  ]);
  return { userId, workspaceId };
}

/** What the account delete does: better-auth drops the user, the workspace cascades. */
async function deleteAccount(userId: string, workspaceId: string): Promise<void> {
  await env.DB.prepare('DELETE FROM "user" WHERE id = ?').bind(userId).run();
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM workspace WHERE id = ?")
    .bind(workspaceId)
    .first<{ n: number }>();
  expect(row?.n).toBe(0);
}

function domainSubject(registrable: string) {
  return { kind: "domain" as const, registrable, url: `https://${registrable}/` };
}

function stubJev(p: number) {
  const run = vi.fn(() => Promise.resolve({ answers: { public_subject: { type: "noul", noul: p } } }));
  Reflect.set(env, "AI", { run });
  return run;
}

async function countRows(table: "jev_verdict" | "user_decision", workspaceId: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE workspace_id = ?`)
    .bind(workspaceId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

afterEach(() => {
  Reflect.deleteProperty(env, "AI");
});

describe("an account deleted mid-request", () => {
  it("records no verdict and raises nothing when the workspace is already gone", async () => {
    const { userId, workspaceId } = await seedWorkspace();
    stubJev(0.95);
    const before = await countRows("jev_verdict", workspaceId);

    await deleteAccount(userId, workspaceId);

    const { outcome, verdict } = await screenPublicSubject(
      workspaceId,
      domainSubject("alphaleteathletics.com"),
      "alphaleteathletics.com",
      NOW,
    );

    expect(outcome).toBe("proceed");
    expect(verdict.p).toBe(0.95);
    expect(await countRows("jev_verdict", workspaceId)).toBe(before);
  });

  it("refuses without a FK failure when the workspace is already gone", async () => {
    const { userId, workspaceId } = await seedWorkspace();
    stubJev(0.05);
    const before = await countRows("user_decision", workspaceId);

    await deleteAccount(userId, workspaceId);

    const result = await screenOnboardingSubject({
      workspaceId,
      userId,
      subject: domainSubject("privateperson.blog"),
      raw: "privateperson.blog",
      answer: null,
      now: NOW,
    });

    expect(result).toEqual({ kind: "refuse", message: "we track brands and creators, not people" });
    expect(await countRows("user_decision", workspaceId)).toBe(before);
  });

  it("confirms without a FK failure when the workspace is already gone", async () => {
    const { userId, workspaceId } = await seedWorkspace();
    stubJev(0.5);
    const before = await countRows("user_decision", workspaceId);

    await deleteAccount(userId, workspaceId);

    const result = await screenOnboardingSubject({
      workspaceId,
      userId,
      subject: domainSubject("somebrand.co"),
      raw: "somebrand.co",
      answer: "business",
      now: NOW,
    });

    expect(result).toEqual({ kind: "proceed" });
    expect(await countRows("user_decision", workspaceId)).toBe(before);
  });

  it("insertSubjectDecision is a no-op once the workspace is gone", async () => {
    const { userId, workspaceId } = await seedWorkspace();
    await deleteAccount(userId, workspaceId);
    const before = await countRows("user_decision", workspaceId);

    await insertSubjectDecision({
      workspaceId,
      userId,
      subject: "alphaleteathletics.com",
      verdict: "public_subject:refused",
      decidedAt: NOW,
    });

    expect(await countRows("user_decision", workspaceId)).toBe(before);
    expect(await readSubjectDecision(workspaceId, "alphaleteathletics.com")).toBeNull();
  });

  it("insertFieldEdits is a no-op once the workspace is gone", async () => {
    const { userId, workspaceId } = await seedWorkspace();
    await deleteAccount(userId, workspaceId);
    const before = await countRows("user_decision", workspaceId);

    await insertFieldEdits([
      {
        workspaceId,
        userId,
        entityId: "entity-ws-gone",
        edit: { field: "name", from: "Alpha", to: "Alphalete" },
        decidedAt: NOW,
      },
    ]);

    expect(await countRows("user_decision", workspaceId)).toBe(before);
  });

  it("still writes both rows while the workspace is live", async () => {
    const { userId, workspaceId } = await seedWorkspace();
    stubJev(0.05);
    const verdicts = await countRows("jev_verdict", workspaceId);
    const decisions = await countRows("user_decision", workspaceId);

    const screened = await screenPublicSubject(
      workspaceId,
      domainSubject("livebrand.com"),
      "livebrand.com",
      NOW,
    );
    expect(screened.outcome).toBe("refuse");

    const result = await screenOnboardingSubject({
      workspaceId,
      userId,
      subject: domainSubject("livebrand.com"),
      raw: "livebrand.com",
      answer: "person",
      now: NOW,
    });

    expect(result).toEqual({ kind: "refuse", message: "we track brands and creators, not people" });
    // The refusal was recorded, so the same subject is not asked again.
    expect(await countRows("jev_verdict", workspaceId)).toBe(verdicts + 1);
    expect(await countRows("user_decision", workspaceId)).toBe(decisions + 1);
    expect(await readSubjectDecision(workspaceId, "livebrand.com")).toBe("public_subject:refused");
  });
});
