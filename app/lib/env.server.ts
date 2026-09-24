import { env } from "cloudflare:workers";
import { z } from "zod";

const BINDING_NAMES = [
  "DB",
  "BETTER_AUTH_URL",
  "BETTER_AUTH_SECRET",
  "EMAIL",
  "SEND_EMAIL",
  "SNAPSHOTS",
  "BROWSER",
  "OAUTH_KV",
  "AGENT_LIMIT",
] as const satisfies readonly (keyof Env)[];

const NOTES = {
  DB: "every read and write fails",
  BETTER_AUTH_URL: "magic links have no canonical origin",
  BETTER_AUTH_SECRET: "sign-in cannot be trusted",
  EMAIL: "magic links and briefs cannot send",
  SEND_EMAIL: "briefs sit unsent",
  SNAPSHOTS: "site snapshots cannot be read or stored",
  BROWSER: "bot-gated page reads cannot escalate",
  OAUTH_KV: "AI apps cannot sign in to /mcp",
  AGENT_LIMIT: "/mcp and /api/v1 have no abuse limit",
  LIVENESS_PING_URL: "absence means no monitor; a set value must be an http(s) URL",
} as const satisfies Record<(typeof BINDING_NAMES)[number] | "LIVENESS_PING_URL", string>;

const NAMES = [...BINDING_NAMES, "LIVENESS_PING_URL"] as const satisfies readonly (keyof typeof NOTES)[];

type EnvName = (typeof NAMES)[number];
type Snapshot = Record<(typeof NAMES)[number], unknown>;

const NAME_SET: ReadonlySet<string> = new Set(NAMES);

const httpUrl = z.url({ protocol: /^https?$/ });

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function binding(method?: "prepare" | "get" | "sendBatch" | "limit") {
  return z.custom((value) => {
    if (!isObject(value)) return false;
    if (!method) return true;
    return typeof Reflect.get(value, method) === "function";
  });
}

const workerEnvSchema = z.object({
  DB: binding("prepare"),
  BETTER_AUTH_URL: httpUrl,
  BETTER_AUTH_SECRET: z.string().min(1),
  EMAIL: binding(),
  SEND_EMAIL: binding("sendBatch"),
  SNAPSHOTS: binding("get"),
  BROWSER: binding(),
  OAUTH_KV: binding("get"),
  AGENT_LIMIT: binding("limit"),
  LIVENESS_PING_URL: httpUrl.optional(),
});

export class WorkerEnvError extends Error {
  readonly names: readonly EnvName[];

  constructor(names: readonly EnvName[]) {
    super(`misconfigured: ${names.map((name) => `${name} (${NOTES[name]})`).join("; ")}`);
    this.name = "WorkerEnvError";
    this.names = names;
  }
}

function isEnvName(key: unknown): key is EnvName {
  return typeof key === "string" && NAME_SET.has(key);
}

function blank(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function livenessUrl(): unknown {
  return blank(Reflect.get(globalThis, "LIVENESS_PING_URL"));
}

function snapshot(): Snapshot {
  return {
    DB: env.DB,
    BETTER_AUTH_URL: blank(env.BETTER_AUTH_URL),
    BETTER_AUTH_SECRET: blank(env.BETTER_AUTH_SECRET),
    EMAIL: env.EMAIL,
    SEND_EMAIL: env.SEND_EMAIL,
    SNAPSHOTS: env.SNAPSHOTS,
    BROWSER: env.BROWSER,
    OAUTH_KV: env.OAUTH_KV,
    AGENT_LIMIT: env.AGENT_LIMIT,
    LIVENESS_PING_URL: livenessUrl(),
  };
}

function evaluate(): WorkerEnvError | undefined {
  const parsed = workerEnvSchema.safeParse(snapshot());
  if (parsed.success) return undefined;
  const found = new Set(parsed.error.issues.map((issue) => issue.path[0]).filter(isEnvName));
  return new WorkerEnvError(NAMES.filter((name) => found.has(name)));
}

export function createWorkerEnvCheck() {
  let verdict: true | WorkerEnvError | undefined;
  return (): void => {
    if (verdict === true) return;
    if (verdict) throw verdict;
    const error = evaluate();
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
