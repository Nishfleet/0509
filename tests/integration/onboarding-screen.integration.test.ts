import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Subject } from "../../app/lib/identity/normalise";
import { REFUSAL, UNAVAILABLE, screenOnboardingSubject } from "../../app/lib/onboarding-screen.server";

const NOW = "2026-09-24T06:00:00.000Z";

let runs = 0;

async function seedWorkspace(): Promise<{ userId: string; workspaceId: string }> {
  runs += 1;
  const userId = `user-onboarding-screen-${String(runs)}`;
  const workspaceId = `ws-onboarding-screen-${String(runs)}`;
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

function domainSubject(registrable: string): Subject {
  return { kind: "domain", registrable, url: `https://${registrable}/` };
}

function stubRun(p: number) {
  const run = vi.fn(() => Promise.resolve({ answers: { public_subject: { type: "boolean", probability: p } } }));
  Reflect.set(env, "AI", { run });
  return run;
}

async function decisionCount(workspaceId: string, verdict: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM user_decision WHERE workspace_id = ? AND verdict = ?",
  )
    .bind(workspaceId, verdict)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function subjectRows(workspaceId: string, subject: string): Promise<{ entities: number; watches: number }> {
  const entities = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM entity WHERE workspace_id = ? AND domain = ?",
  )
    .bind(workspaceId, subject)
    .first<{ n: number }>();
  const watches = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM watch
     JOIN entity ON entity.id = watch.entity_id
     WHERE entity.workspace_id = ? AND entity.domain = ?`,
  )
    .bind(workspaceId, subject)
    .first<{ n: number }>();
  return { entities: entities?.n ?? 0, watches: watches?.n ?? 0 };
}

afterEach(() => {
  Reflect.deleteProperty(env, "AI");
});

describe("screenOnboardingSubject", () => {
  it("proceeds a confidently public subject without recording a user decision", async () => {
    const { userId, workspaceId } = await seedWorkspace();
    const run = stubRun(0.95);
    const subject = `public-${String(runs)}.example`;

    const result = await screenOnboardingSubject({
      workspaceId,
      userId,
      subject: domainSubject(subject),
      raw: subject,
      answer: null,
      now: NOW,
    });

    expect(result).toEqual({ kind: "proceed" });
    expect(run).toHaveBeenCalledTimes(1);
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM user_decision WHERE workspace_id = ?")
      .bind(workspaceId)
      .first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });

  it("refuses a confidently private handle, records the refusal, and creates no entity or watch", async () => {
    const { userId, workspaceId } = await seedWorkspace();
    stubRun(0.05);
    const subject = `private-${String(runs)}`;

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const result = await screenOnboardingSubject({
        workspaceId,
        userId,
        subject: { kind: "handle", registrable: subject, url: null },
        raw: `@${subject}`,
        answer: null,
        now: NOW,
      });

      expect(result).toEqual({ kind: "refuse", message: REFUSAL });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(await decisionCount(workspaceId, "public_subject:refused")).toBe(1);
      expect(await subjectRows(workspaceId, subject)).toEqual({ entities: 0, watches: 0 });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("asks about an ambiguous subject when the user has not answered", async () => {
    const { userId, workspaceId } = await seedWorkspace();
    stubRun(0.5);
    const subject = `ambiguous-${String(runs)}.example`;

    const result = await screenOnboardingSubject({
      workspaceId,
      userId,
      subject: domainSubject(subject),
      raw: subject,
      answer: null,
      now: NOW,
    });

    expect(result).toEqual({ kind: "ask", subject });
  });

  it("records a business answer and reuses it without another judgment", async () => {
    const { userId, workspaceId } = await seedWorkspace();
    const run = stubRun(0.5);
    const subject = `confirmed-${String(runs)}.example`;

    const first = await screenOnboardingSubject({
      workspaceId,
      userId,
      subject: domainSubject(subject),
      raw: subject,
      answer: "business",
      now: NOW,
    });
    expect(first).toEqual({ kind: "proceed" });
    expect(await decisionCount(workspaceId, "public_subject:confirmed")).toBe(1);

    const second = await screenOnboardingSubject({
      workspaceId,
      userId,
      subject: domainSubject(subject),
      raw: subject,
      answer: null,
      now: NOW,
    });
    expect(second).toEqual({ kind: "proceed" });
    expect(run).toHaveBeenCalledTimes(1);
    expect(await decisionCount(workspaceId, "public_subject:refused")).toBe(0);
  });

  it("does not write a refusal beside an existing confirmation", async () => {
    const { userId, workspaceId } = await seedWorkspace();
    const run = stubRun(0.5);
    const subject = {
      kind: "handle" as const,
      platform: "instagram" as const,
      registrable: "accounts",
      url: "https://www.instagram.com/accounts/",
    };

    const first = await screenOnboardingSubject({
      workspaceId,
      userId,
      subject,
      raw: "https://www.instagram.com/accounts/",
      answer: "business",
      now: NOW,
    });
    expect(first).toEqual({ kind: "proceed" });

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const second = await screenOnboardingSubject({
        workspaceId,
        userId,
        subject,
        raw: "https://www.instagram.com/accounts/login",
        answer: null,
        now: NOW,
      });
      expect(second).toEqual({ kind: "proceed" });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(run).toHaveBeenCalledTimes(1);
      expect(await decisionCount(workspaceId, "public_subject:confirmed")).toBe(1);
      expect(await decisionCount(workspaceId, "public_subject:refused")).toBe(0);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("asks again with no answer without paying for a second judgment", async () => {
    const { userId, workspaceId } = await seedWorkspace();
    const run = stubRun(0.5);
    const subject = `ask-twice-${String(runs)}.example`;

    const first = await screenOnboardingSubject({
      workspaceId,
      userId,
      subject: domainSubject(subject),
      raw: subject,
      answer: null,
      now: NOW,
    });
    expect(first).toEqual({ kind: "ask", subject });

    const second = await screenOnboardingSubject({
      workspaceId,
      userId,
      subject: domainSubject(subject),
      raw: subject,
      answer: null,
      now: NOW,
    });
    expect(second).toEqual({ kind: "ask", subject });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("refuses again from the recorded decision without another judgment", async () => {
    const { userId, workspaceId } = await seedWorkspace();
    const run = stubRun(0.05);
    const subject = `refuse-twice-${String(runs)}.example`;

    const first = await screenOnboardingSubject({
      workspaceId,
      userId,
      subject: domainSubject(subject),
      raw: subject,
      answer: null,
      now: NOW,
    });
    expect(first).toEqual({ kind: "refuse", message: REFUSAL });

    const second = await screenOnboardingSubject({
      workspaceId,
      userId,
      subject: domainSubject(subject),
      raw: subject,
      answer: null,
      now: NOW,
    });
    expect(second).toEqual({ kind: "refuse", message: REFUSAL });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not let an answer overturn a confident refusal", async () => {
    const { userId, workspaceId } = await seedWorkspace();
    stubRun(0.05);
    const subject = `answer-refused-${String(runs)}.example`;

    const result = await screenOnboardingSubject({
      workspaceId,
      userId,
      subject: domainSubject(subject),
      raw: subject,
      answer: "business",
      now: NOW,
    });

    expect(result).toEqual({ kind: "refuse", message: REFUSAL });
    expect(await decisionCount(workspaceId, "public_subject:refused")).toBe(1);
  });

  it("returns unavailable when Jev cannot be reached", async () => {
    const { userId, workspaceId } = await seedWorkspace();
    const run = vi.fn(() => Promise.reject(new Error("Jev unavailable")));
    Reflect.set(env, "AI", { run });
    const subject = `unavailable-${String(runs)}.example`;

    const result = await screenOnboardingSubject({
      workspaceId,
      userId,
      subject: domainSubject(subject),
      raw: subject,
      answer: null,
      now: NOW,
    });

    expect(result).toEqual({ kind: "unavailable", message: UNAVAILABLE });
    expect(await decisionCount(workspaceId, "public_subject:refused")).toBe(0);
  });

  it("refuses a login address in code, asks neither Jev nor the network, and stores no entity or watch", async () => {
    const { userId, workspaceId } = await seedWorkspace();
    const run = vi.fn(() => Promise.reject(new Error("jev must not be asked")));
    Reflect.set(env, "AI", { run });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const raw = "https://www.instagram.com/accounts/login";

    try {
      const result = await screenOnboardingSubject({
        workspaceId,
        userId,
        subject: {
          kind: "handle",
          platform: "instagram",
          registrable: "accounts",
          url: "https://www.instagram.com/accounts/",
        },
        raw,
        answer: "business",
        now: NOW,
      });

      expect(result).toEqual({ kind: "refuse", message: REFUSAL });
      expect(run).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(await decisionCount(workspaceId, "public_subject:refused")).toBe(1);
      expect(await subjectRows(workspaceId, "accounts")).toEqual({ entities: 0, watches: 0 });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("does not fetch a platform profile before asking Jev", async () => {
    const { userId, workspaceId } = await seedWorkspace();
    const run = stubRun(0.95);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const subject = `brand-${String(runs)}`;

    try {
      const result = await screenOnboardingSubject({
        workspaceId,
        userId,
        subject: {
          kind: "handle",
          platform: "instagram",
          registrable: subject,
          url: `https://www.instagram.com/${subject}/`,
        },
        raw: `https://www.instagram.com/${subject}/`,
        answer: null,
        now: NOW,
      });

      expect(result).toEqual({ kind: "proceed" });
      expect(run).toHaveBeenCalledTimes(1);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
