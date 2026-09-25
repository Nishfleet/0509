import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Subject } from "../../app/lib/identity/normalise";
import {
  PUBLIC_SUBJECT,
  screenPublicSubject,
  type PublicSubjectOutcome,
} from "../../app/lib/jev/public-subject.server";
import { JevUnavailableError } from "../../app/lib/jev/client.server";

const NOW = "2026-09-24T06:00:00.000Z";

let runs = 0;

async function seedWorkspace(): Promise<string> {
  runs += 1;
  const userId = `user-public-subject-${String(runs)}`;
  const workspaceId = `ws-public-subject-${String(runs)}`;
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?2, 1, ?3, ?3)',
    ).bind(userId, `${userId}@example.com`, NOW),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Gymshark', ?2, 'UTC', 1, 8, ?3)",
    ).bind(workspaceId, userId, NOW),
  ]);
  return workspaceId;
}

function subject(kind: "domain" | "handle" | "channel", registrable: string): Subject {
  if (kind === "domain") return { kind, registrable, url: `https://${registrable}/` };
  if (kind === "handle") return { kind, registrable, url: null };
  return { kind, platform: "youtube", registrable, url: `https://www.youtube.com/@${registrable}` };
}

afterEach(() => {
  Reflect.deleteProperty(env, "AI");
});

describe("screenPublicSubject", () => {
  it("returns proceed when Jev p is at or above 0.9", async () => {
    const workspaceId = await seedWorkspace();
    const run = vi.fn(() =>
      Promise.resolve({ answers: { public_subject: { type: "boolean", probability: 0.95 } } }),
    );
    Reflect.set(env, "AI", { run });

    const { outcome, verdict } = await screenPublicSubject(
      workspaceId,
      subject("domain", "alphaleteathletics.com"),
      "alphaleteathletics.com",
      NOW,
    );

    expect(outcome).toBe<PublicSubjectOutcome>("proceed");
    expect(verdict).toMatchObject({ questionId: "public_subject", p: 0.95, cached: false });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toBe("typesafe/jev");
    const request = run.mock.calls[0]?.[1] as {
      questions: { public_subject: { type: string; instructions: string; criteria: { true: string; false: string } } };
    };
    expect(request.questions.public_subject).toEqual({
      type: "boolean",
      instructions: PUBLIC_SUBJECT.instructions,
      criteria: { true: PUBLIC_SUBJECT.whenTrue, false: PUBLIC_SUBJECT.whenFalse },
    });
  });

  it("returns ask when Jev p is in the ambiguous middle band", async () => {
    const workspaceId = await seedWorkspace();
    const run = vi.fn(() =>
      Promise.resolve({ answers: { public_subject: { type: "boolean", probability: 0.5 } } }),
    );
    Reflect.set(env, "AI", { run });

    const { outcome, verdict } = await screenPublicSubject(
      workspaceId,
      subject("handle", "smallbaker"),
      "@smallbaker",
      NOW,
    );

    expect(outcome).toBe<PublicSubjectOutcome>("ask");
    expect(verdict.p).toBe(0.5);
  });

  it("returns refuse when Jev p is at or below 0.1", async () => {
    const workspaceId = await seedWorkspace();
    const run = vi.fn(() =>
      Promise.resolve({ answers: { public_subject: { type: "boolean", probability: 0.05 } } }),
    );
    Reflect.set(env, "AI", { run });

    const { outcome, verdict } = await screenPublicSubject(
      workspaceId,
      subject("channel", "personpage"),
      "https://www.youtube.com/@personpage",
      NOW,
    );

    expect(outcome).toBe<PublicSubjectOutcome>("refuse");
    expect(verdict.p).toBe(0.05);
  });

  it("persists a jev_verdict row on the first call and reuses the cached verdict on the second", async () => {
    const workspaceId = await seedWorkspace();
    const run = vi.fn(() =>
      Promise.resolve({ answers: { public_subject: { type: "boolean", probability: 0.95 } } }),
    );
    Reflect.set(env, "AI", { run });

    const first = await screenPublicSubject(
      workspaceId,
      subject("domain", "alphaleteathletics.com"),
      "alphaleteathletics.com",
      NOW,
    );
    expect(first.verdict.cached).toBe(false);

    const rows = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM jev_verdict WHERE workspace_id = ? AND question_id = 'public_subject'",
    )
      .bind(workspaceId)
      .first<{ n: number }>();
    expect(rows?.n).toBe(1);

    const second = await screenPublicSubject(
      workspaceId,
      subject("domain", "alphaleteathletics.com"),
      "alphaleteathletics.com",
      NOW,
    );

    expect(second.verdict.cached).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("throws JevUnavailableError when Jev refuses", async () => {
    const workspaceId = await seedWorkspace();
    const run = vi.fn(() => Promise.reject(new Error("Insufficient balance; add money to your gateway")));
    Reflect.set(env, "AI", { run });

    await expect(
      screenPublicSubject(
        workspaceId,
        subject("domain", "alphaleteathletics.com"),
        "alphaleteathletics.com",
        NOW,
      ),
    ).rejects.toThrow(JevUnavailableError);
  });
});
