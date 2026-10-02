import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { afterEach, describe, expect, it } from "vitest";
import {
  _INTERNAL_flushLogsBuffer,
  captureException,
  createStackParser,
  flush,
  getClient,
  initAndBind,
  nodeStackLineParser,
} from "@sentry/core";
import { CloudflareClient, consoleLoggingIntegration } from "@sentry/cloudflare";
import { sentryOptions } from "../../workers/sentry";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const envelopes: unknown[] = [];

function fakeTransport() {
  return {
    send(envelope: unknown) {
      envelopes.push(envelope);
    },
    async flush() {},
    async close() {},
  };
}

afterEach(() => {
  envelopes.length = 0;
});

const USER_DATA_MESSAGE = "never carry customer data or prompt input";

function initClient(): void {
  initAndBind(CloudflareClient, {
    dsn: "https://examplePublicKey@o0.ingest.sentry.io/0",
    enableLogs: true,
    integrations: [consoleLoggingIntegration()],
    defaultIntegrations: false,
    transport: fakeTransport,
    // `@sentry/cloudflare`'s own init() supplies this from its vendored
    // workerd stack parser; the SDK ships no top-level init, so the test
    // builds the same client the Worker gets.
    stackParser: createStackParser([10, nodeStackLineParser]),
  });
}

function logBodies(): string[] {
  const client = getClient();
  if (client) {
    _INTERNAL_flushLogsBuffer(client);
  }
  const bodies: string[] = [];
  for (const envelope of envelopes) {
    const [, items] = envelope as [unknown, unknown[]];
    for (const item of items) {
      const [header, data] = item as [unknown, unknown];
      if ((header as { type?: string }).type !== "log") continue;
      for (const log of (data as { items: Array<{ body?: string }> }).items) {
        if (log.body) bodies.push(log.body);
      }
    }
  }
  return bodies;
}

describe("Sentry Logs (#6604)", () => {
  it("sentryOptions enables Logs and registers consoleLoggingIntegration", () => {
    const opts = sentryOptions({} as unknown as Env);
    expect(opts.enableLogs).toBe(true);
    const integrations = opts.integrations as Array<{ name: string }>;
    expect(integrations.some((i) => i.name === "ConsoleLogs")).toBe(true);
  });

  it("a console log shares trace id with an error captured in the same scope", async () => {
    initClient();
    captureException(new Error("probe error"));
    console.log("probe log");

    const client = getClient();
    if (client) {
      _INTERNAL_flushLogsBuffer(client);
    }
    await flush();

    const logTraceIds: string[] = [];
    const eventTraceIds: string[] = [];
    for (const envelope of envelopes) {
      const [, items] = envelope as [unknown, unknown[]];
      for (const item of items) {
        const [header, data] = item as [unknown, unknown];
        const h = header as { type?: string };
        if (h.type === "log") {
          const container = data as { items: Array<{ trace_id?: string }> };
          for (const log of container.items) {
            if (log.trace_id) logTraceIds.push(log.trace_id);
          }
        }
        if (h.type === "event") {
          const ev = data as { contexts?: { trace?: { trace_id?: string } } };
          if (ev.contexts?.trace?.trace_id) eventTraceIds.push(ev.contexts.trace.trace_id);
        }
      }
    }

    expect(logTraceIds.length).toBeGreaterThan(0);
    expect(eventTraceIds.length).toBeGreaterThan(0);
    expect(eventTraceIds.some((id) => logTraceIds.includes(id))).toBe(true);
  });

  it("carries the operator id the gate allows and nothing the gate bans", () => {
    initClient();
    // The shape the nightly crons log: the event name and the count an
    // operator reads. workspaceId is the one id 0509#5786 allows.
    console.log(JSON.stringify({ event: "standing.nightly", workspaceId: "ws_1", catchUps: 2 }));

    const bodies = logBodies();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("standing.nightly");
    expect(bodies[0]).toContain("ws_1");
    for (const banned of ["email", "userId", "ip", "prompt", "token", "subject", "password"]) {
      expect(bodies[0]).not.toContain(banned);
    }
  });

  it("leaves the live log lines workers/app.ts and workers/sentry.ts under the #5786 gate", { timeout: 60_000 }, async () => {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    for (const rel of ["workers/sentry.ts", "workers/app.ts", "workers/standing/nightly.ts"]) {
      const results = await eslint.lintFiles([path.join(REPO_ROOT, rel)]);
      const messages = results.flatMap((result) => result.messages).map((message) => message.message);
      expect(messages.filter((message) => message.includes(USER_DATA_MESSAGE))).toEqual([]);
    }
  });

  it("still flags a customer-data value on the log path a console line takes", { timeout: 60_000 }, async () => {
    const probe = path.join(REPO_ROOT, "app/lib/probe-sentry-logs-tmp.ts");
    await mkdir(path.dirname(probe), { recursive: true });
    await writeFile(probe, "declare const subject: { registrable: string };\nconsole.log(subject.registrable);\n");
    try {
      const eslint = new ESLint({ cwd: REPO_ROOT });
      const results = await eslint.lintFiles([probe]);
      const messages = results.flatMap((result) => result.messages).map((message) => message.message);
      expect(messages.some((message) => message.includes(USER_DATA_MESSAGE))).toBe(true);
    } finally {
      await rm(probe, { force: true });
    }
  });
});
