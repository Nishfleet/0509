import { z } from "zod";

const NOTES = {
  DB: "every read and write fails",
  BETTER_AUTH_URL: "magic links have no canonical origin",
  BETTER_AUTH_SECRET: "sign-in cannot be trusted",
  EMAIL: "magic links and briefs cannot send",
  SEND_EMAIL: "briefs sit unsent",
  CARD_ARTIFACTS: "public standing cards cannot be served",
  BROWSER: "bot-gated page reads cannot escalate",
  LIVENESS_PING_URL: "absence means no monitor; a set value must be an http(s) URL",
} as const;

type EnvName = keyof typeof NOTES;

const NAMES = Object.keys(NOTES) as EnvName[];

interface EnvGlobals {
  LIVENESS_PING_URL?: string;
}

export class WorkerEnvError extends Error {
  readonly names: readonly EnvName[];

  constructor(names: readonly EnvName[]) {
    super(`misconfigured: ${names.map((name) => `${name} (${NOTES[name]})`).join("; ")}`);
    this.name = "WorkerEnvError";
    this.names = names;
  }
}

function binding(method?: "prepare" | "get" | "sendBatch") {
  return z.custom((value) => {
    if (typeof value !== "object" || value === null) return false;
    if (!method) return true;
    return typeof (value as Record<string, unknown>)[method] === "function";
  });
}

function httpUrl() {
  return z.string().refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  });
}

const workerEnvSchema = z.object({
  DB: binding("prepare").describe(NOTES.DB),
  BETTER_AUTH_URL: httpUrl().describe(NOTES.BETTER_AUTH_URL),
  BETTER_AUTH_SECRET: z.string().min(1).describe(NOTES.BETTER_AUTH_SECRET),
  EMAIL: binding().describe(NOTES.EMAIL),
  SEND_EMAIL: binding("sendBatch").describe(NOTES.SEND_EMAIL),
  CARD_ARTIFACTS: binding("get").describe(NOTES.CARD_ARTIFACTS),
  BROWSER: binding().describe(NOTES.BROWSER),
  LIVENESS_PING_URL: httpUrl().optional().describe(NOTES.LIVENESS_PING_URL),
});

function blankToUndefined(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function snapshot(env: object, globals: EnvGlobals) {
  const record = env as Record<string, unknown>;
  return {
    DB: record.DB,
    BETTER_AUTH_URL: blankToUndefined(record.BETTER_AUTH_URL),
    BETTER_AUTH_SECRET: blankToUndefined(record.BETTER_AUTH_SECRET),
    EMAIL: record.EMAIL,
    SEND_EMAIL: record.SEND_EMAIL,
    CARD_ARTIFACTS: record.CARD_ARTIFACTS,
    BROWSER: record.BROWSER,
    LIVENESS_PING_URL: blankToUndefined(globals.LIVENESS_PING_URL),
  };
}

function evaluate(env: object, globals: EnvGlobals): WorkerEnvError | undefined {
  const parsed = workerEnvSchema.safeParse(snapshot(env, globals));
  if (parsed.success) return undefined;
  const found = new Set(
    parsed.error.issues
      .map((issue) => issue.path[0])
      .filter((key): key is EnvName => typeof key === "string" && key in NOTES),
  );
  return new WorkerEnvError(NAMES.filter((name) => found.has(name)));
}

export function createWorkerEnvCheck(globals: EnvGlobals = globalThis as EnvGlobals) {
  let verdict: true | WorkerEnvError | undefined;
  return (env: object): void => {
    if (verdict === true) return;
    if (verdict) throw verdict;
    const error = evaluate(env, globals);
    if (error) {
      verdict = error;
      throw error;
    }
    verdict = true;
  };
}

export const assertWorkerEnv = createWorkerEnvCheck();

export function workerEnvFailureResponse(error: WorkerEnvError): Response {
  console.error(error.message);
  return new Response(error.message, {
    status: 503,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
