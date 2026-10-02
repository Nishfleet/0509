import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import {
  CloudflareClient,
  captureException,
  flush,
  getCurrentScope,
  logger,
  setCurrentClient,
} from "@sentry/cloudflare";
import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
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

// The client the Worker gets. The SDK's internal `initAndBind` is exactly these
// three steps, and the package's own entry point ships no top-level `init` in
// v10, so building the client from `sentryOptions` with only what a test must
// know how to send overridden keeps every option under test — `enableLogs`,
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
  attributes?: Record<string, { value?: unknown; type?: string }>;
}

// The SDK ships each log attribute as one `{ value, type }` pair. A container
// arrives as a JSON string in that `value`, so the redaction is asserted on
// the text Sentry will actually store.
function attribute(item: LogItem | undefined, key: string): string {
  const entry = item?.attributes?.[key];
  return typeof entry?.value === "string" ? entry.value : JSON.stringify(entry?.value ?? null);
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

const clientBeforeTheSuite = getCurrentScope().getClient();

beforeAll(initProductionOptions);

afterEach(() => {
  envelopes.length = 0;
});

// The suite binds a global Sentry client, so hand the process back the one it
// had. Without this, a later test file in the same worker would log into this
// recording transport instead of its own.
afterAll(() => {
  if (clientBeforeTheSuite !== undefined) setCurrentClient(clientBeforeTheSuite);
});

describe("Sentry Logs (#6604)", () => {
  it("sentryOptions enables Logs and registers consoleLoggingIntegration", () => {
    const opts = sentryOptions({} as unknown as Env);
    expect(opts.enableLogs).toBe(true);
    const integrations = opts.integrations as { name: string }[];
    expect(integrations.some((integration) => integration.name === "ConsoleLogs")).toBe(true);
  });

  it("ships one log item per console line, in Sentry's own log envelope", async () => {
    console.warn(JSON.stringify({ event: "probe.one_line", workspaceId: "ws_1" }));

    await flush();

    const matching = logItems().filter((log) => log.body?.includes("probe.one_line"));
    expect(matching).toHaveLength(1);
    expect(matching[0]?.body).toContain("workspaceId");
  });

  it("keeps an info console line out of Logs, so only warn and error ship", async () => {
    console.log(JSON.stringify({ event: "probe.info_line" }));
    console.warn(JSON.stringify({ event: "probe.warn_line" }));

    await flush();

    expect(logItems().filter((log) => log.body?.includes("probe.info_line"))).toHaveLength(0);
    expect(logItems().filter((log) => log.body?.includes("probe.warn_line"))).toHaveLength(1);
  });

  it("adds the trace id of the error captured in the same request to the log line", async () => {
    captureException(new Error("probe error"));
    console.warn("probe log");
    await flush();

    const probeLog = logItems().find((log) => log.body?.includes("probe log"));
    expect(probeLog?.trace_id).toBeDefined();
    expect(eventTraceIds()).toContain(probeLog?.trace_id);
  });

  it("scrubs customer data out of the log it ships, under the #5786 gate", async () => {
    // A value a name-based selector cannot see: `contact` and `back` are not
    // on 0509#5786's banned list, so the gate lets the line through. The log
    // hook is what keeps their contents out of Sentry.
    console.warn(
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

  it("scrubs a customer value nested inside an attribute object and an array", async () => {
    // The same probe through `Sentry.logger` instead of a console string, so
    // the value travels as a log attribute rather than inside the message.
    // Removing the recursive walk in `scrubLogValue` fails this test.
    const cycle: Record<string, unknown> = { note: "cycle.ada@customer.example" };
    cycle.self = cycle;
    logger.warn("probe.nested", {
      contact: { name: "ada@customer.example" },
      links: ["https://0509.io/u/tok-SECRET", { inner: "bo@customer.example" }],
      deep: { a: { b: { c: { d: { e: { f: "deep@customer.example" } } } } } },
      cycle,
      at: new Date(0),
    });

    await flush();

    const [shipped] = logItems().filter((log) => log.body?.includes("probe.nested"));
    expect(shipped).toBeDefined();
    expect(attribute(shipped, "contact")).toBe('{"name":"[redacted]"}');
    expect(attribute(shipped, "links")).toBe('["https://0509.io/u/[redacted]",{"inner":"[redacted]"}]');
    // Past the depth cap the subtree is redacted whole, never copied through.
    expect(attribute(shipped, "deep")).toBe('{"a":{"b":{"c":{"d":{"e":{"f":"[redacted]"}}}}}}');
    // A self-referencing attribute terminates and is redacted.
    expect(attribute(shipped, "cycle")).toContain("[redacted]");
    expect(attribute(shipped, "cycle")).not.toContain("ada@customer.example");
    // A `Date` keeps its own shape instead of becoming `{}`.
    expect(attribute(shipped, "at")).toBe('"1970-01-01T00:00:00.000Z"');
  });

  it("scrubs attribute keys at every level and keeps both values when two keys collapse", async () => {
    logger.warn("probe.keys", {
      "ada@customer.example": 1,
      "bo@customer.example": 2,
      kept: 3,
      nested: { "cy@customer.example": 4, "di@customer.example": 5 },
    });

    await flush();

    const [shipped] = logItems().filter((log) => log.body?.includes("probe.keys"));
    const keys = Object.keys(shipped?.attributes ?? {});
    expect(keys.filter((key) => key.includes("customer.example"))).toEqual([]);
    expect(attribute(shipped, "[redacted]")).toBe("1");
    expect(attribute(shipped, "[redacted]#2")).toBe("2");
    expect(attribute(shipped, "kept")).toBe("3");
    expect(attribute(shipped, "nested")).toBe('{"[redacted]":4,"[redacted]#2":5}');
  });

  it("redacts a value that is not a plain object, array or Date, so nothing rides a hidden getter or toJSON", async () => {
    class Hidden {
      toJSON(): string {
        return "ada@customer.example";
      }
    }
    logger.warn("probe.opaque", {
      failure: new Error("ada@customer.example"),
      hidden: new Hidden(),
      table: new Map([["who", "ada@customer.example"]]),
      at: new Date(0),
    });

    await flush();

    const [shipped] = logItems().filter((log) => log.body?.includes("probe.opaque"));
    expect(shipped).toBeDefined();
    expect(attribute(shipped, "failure")).toBe("[redacted]");
    expect(attribute(shipped, "hidden")).toBe("[redacted]");
    expect(attribute(shipped, "table")).toBe("[redacted]");
    expect(attribute(shipped, "at")).toBe('"1970-01-01T00:00:00.000Z"');
  });

  it("redacts every container past the 2000 visited cap, never copying one through", async () => {
    logger.warn("probe.wide", {
      rows: Array.from({ length: 2500 }, () => ({ who: "ada@customer.example" })),
    });

    await flush();

    const [shipped] = logItems().filter((log) => log.body?.includes("probe.wide"));
    const rows = JSON.parse(attribute(shipped, "rows")) as unknown[];
    expect(rows).toHaveLength(2500);
    expect(rows[0]).toEqual({ who: "[redacted]" });
    expect(rows[1998]).toEqual({ who: "[redacted]" });
    expect(rows[1999]).toBe("[redacted]");
    expect(rows[2499]).toBe("[redacted]");
    expect(attribute(shipped, "rows")).not.toContain("customer.example");
  });

  it("scrubs the template and parameter attributes of a formatted log line", async () => {
    const email = "ada@customer.example";
    logger.warn(logger.fmt`probe.formatted ${email} signed in`);

    await flush();

    const [shipped] = logItems().filter((log) => log.body?.includes("probe.formatted"));
    expect(shipped).toBeDefined();
    expect(shipped?.body).not.toContain("customer.example");
    expect(attribute(shipped, "sentry.message.template")).toBe("probe.formatted %s signed in");
    expect(attribute(shipped, "sentry.message.parameter.0")).toBe("[redacted]");
    expect(JSON.stringify(shipped)).not.toContain("customer.example");
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
    // eslint applies the gate through the `app/**` block, so the probe has to
    // live under app/. The directory name is unique per run, so an interrupted
    // run cannot leave an artifact a later run reads.
    const scratch = await mkdtemp(path.join(REPO_ROOT, "app", "sentry-logs-probe-"));
    const probe = path.join(scratch, "probe.ts");
    await writeFile(probe, "declare const subject: { registrable: string };\nconsole.log(subject.registrable);\n");
    try {
      const eslint = new ESLint({ cwd: REPO_ROOT });
      const results = await eslint.lintFiles([probe]);
      const messages = results.flatMap((result) => result.messages).map((message) => message.message);
      expect(messages.some((message) => message.includes(USER_DATA_MESSAGE))).toBe(true);
    } finally {
      await rm(scratch, { force: true, recursive: true });
    }
  });
});
