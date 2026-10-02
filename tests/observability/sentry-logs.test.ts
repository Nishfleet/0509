import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { CloudflareClient, captureException, flush, setCurrentClient } from "@sentry/cloudflare";
import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { sentryOptions } from "../../workers/sentry";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const USER_DATA_MESSAGE = "never carry customer data or prompt input";

const envelopes: unknown[] = [];

// A transport that records instead of sending, with the return shapes
// `Transport` declares.
function fakeTransport() {
  return {
    send: (envelope: unknown) => {
      envelopes.push(envelope);
      return Promise.resolve({});
    },
    flush: () => Promise.resolve(true),
  };
}

// The client the Worker gets. `@sentry/core`'s `initAndBind` is exactly these
// three steps, and v10 of the SDK ships no top-level `init`, so building the
// client from `sentryOptions` with only what a test must know how to send
// overridden keeps every option under test — `enableLogs`,
// `consoleLoggingIntegration()`, `beforeSendLog` — the ones the Worker runs:
// the dsn, the recording transport, and a stack parser that drops frames
// because no assertion here reads a stack frame.
function initProductionOptions(): void {
  const client = new CloudflareClient({
    ...sentryOptions({} as unknown as Env),
    dsn: "https://examplePublicKey@o0.ingest.sentry.io/0",
    transport: fakeTransport,
    stackParser: () => [],
  });
  setCurrentClient(client);
  client.init();
}

interface LogItem {
  body?: string;
  trace_id?: string;
}

interface EnvelopeItem {
  header: { type?: string; trace?: { trace_id?: string } };
  logs?: LogItem[];
}

function items(): EnvelopeItem[] {
  return envelopes.flatMap((envelope) => {
    const [, items] = envelope as [Record<string, unknown>, [unknown, unknown][]];
    return items.map(([header, data]) => ({
      header: header as EnvelopeItem["header"],
      logs: (data as { items?: LogItem[] }).items,
    }));
  });
}

function logItems(): LogItem[] {
  return items()
    .filter((item) => item.header.type === "log")
    .flatMap((item) => item.logs ?? []);
}

/** The trace every error event ships in its envelope header, which is what Sentry ingests. */
function eventTraceIds(): string[] {
  return envelopes
    .map((envelope) => {
      const [headers] = envelope as [Record<string, unknown>, unknown[]];
      return (headers.trace as { trace_id?: string } | undefined)?.trace_id;
    })
    .filter((traceId): traceId is string => typeof traceId === "string");
}

beforeAll(initProductionOptions);

afterEach(() => {
  envelopes.length = 0;
});

describe("Sentry Logs (#6604)", () => {
  it("sentryOptions enables Logs and registers consoleLoggingIntegration", () => {
    const opts = sentryOptions({} as unknown as Env);
    expect(opts.enableLogs).toBe(true);
    const integrations = opts.integrations as { name: string }[];
    expect(integrations.some((integration) => integration.name === "ConsoleLogs")).toBe(true);
  });

  it("ships one log item per console line, in Sentry's own log envelope", async () => {
    console.log(JSON.stringify({ event: "probe.one_line", workspaceId: "ws_1" }));

    await flush();

    const matching = logItems().filter((log) => log.body?.includes("probe.one_line"));
    expect(matching).toHaveLength(1);
    expect(matching[0]?.body).toContain("workspaceId");
  });

  it("adds the trace id of the error captured in the same request to the log line", async () => {
    captureException(new Error("probe error"));
    console.log("probe log");
    await flush();

    const probeLog = logItems().find((log) => log.body?.includes("probe log"));
    expect(probeLog?.trace_id).toBeDefined();
    expect(eventTraceIds()).toContain(probeLog?.trace_id);
  });

  it("scrubs customer data out of the log it ships, under the #5786 gate", async () => {
    // A value a name-based selector cannot see: `contact` and `back` are not
    // on 0509#5786's banned list, so the gate lets the line through. The log
    // hook is what keeps their contents out of Sentry.
    console.log(
      JSON.stringify({
        event: "probe.redaction",
        workspaceId: "ws_1",
        contact: "ada@customer.example",
        back: "https://0509.io/u/tok-SECRET",
      }),
    );

    await flush();

    const [body] = logItems()
      .map((log) => log.body ?? "")
      .filter((logBody) => logBody.includes("probe.redaction"));
    expect(body).toContain("probe.redaction");
    expect(body).toContain("ws_1");
    expect(body).not.toContain("ada@customer.example");
    expect(body).not.toContain("tok-SECRET");
    expect(body).toContain("[redacted]");
  });

  it("keeps the live console lines under the #5786 log gate", { timeout: 60_000 }, async () => {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    for (const rel of ["workers/sentry.ts", "workers/app.ts", "workers/standing/nightly.ts"]) {
      const results = await eslint.lintFiles([path.join(REPO_ROOT, rel)]);
      const messages = results.flatMap((result) => result.messages).map((message) => message.message);
      expect(messages.filter((message) => message.includes(USER_DATA_MESSAGE))).toEqual([]);
    }
  });

  it("keeps the #5786 gate firing on the log path a console line takes", { timeout: 60_000 }, async () => {
    const probe = path.join(REPO_ROOT, "app/lib", "probe-sentry-logs-tmp.ts");
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
