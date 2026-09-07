const LOOPBACK_HOST = "127.0.0.1";
const E2E_TEST_MODE_HEADER = "x-0509-e2e-test-mode";
const E2E_FIXTURE_COOKIE = "f9_e2e_fixture";

export const E2E_HARNESS_REPLAY_MAX_JSON_BYTES = 16 * 1024;
export const E2E_HARNESS_CLOCK_FUTURE_TOLERANCE_MS = 60 * 1000;
export const E2E_HARNESS_GUARD_FAILURE_RESPONSE = Object.freeze({
  status: 404,
  cacheControl: "no-store",
  headers: Object.freeze({ "cache-control": "no-store" }),
} as const);

export const E2E_FIXTURE_USER_ID_PATTERN = /^e2e-[a-z0-9-]{3,80}$/u;
export const E2E_REPLAY_RUN_ID_PATTERN = /^e2e-run-[a-z0-9-]{1,64}$/u;
export const E2E_REPLAY_IDEMPOTENCY_KEY_PATTERN = /^e2e-[a-z0-9-]{1,96}$/u;
export const E2E_REPLAY_SCENARIOS = Object.freeze(["j3", "j4", "j5", "j6"] as const);

const REPLAY_BODY_FIELDS = Object.freeze([
  "userId",
  "runId",
  "idempotencyKey",
  "scenario",
  "clock",
] as const);

type ReplayScenario = (typeof E2E_REPLAY_SCENARIOS)[number];

export interface E2EHarnessNetworkDenyDecision {
  enabled: boolean;
  failClosed: boolean;
}

export interface E2EHarnessTestModeDecision {
  enabled: boolean;
  sentinel: boolean;
}

export interface E2EHarnessReplayDecisions {
  networkDeny: E2EHarnessNetworkDenyDecision;
  testMode: E2EHarnessTestModeDecision;
}

export interface E2EHarnessReplayBody {
  userId: string;
  runId: string;
  idempotencyKey: string;
  scenario: ReplayScenario;
  clock: string;
}

export interface E2EHarnessReplayMetadata extends E2EHarnessReplayBody {
  origin: string;
}

export type E2EHarnessGuardRejectReason =
  | "origin"
  | "method"
  | "content_type"
  | "test_mode_header"
  | "fixture_cookie"
  | "network_deny"
  | "test_mode_decision"
  | "body_missing"
  | "body_too_large"
  | "body_encoding"
  | "body_json"
  | "body_shape"
  | "unknown_fields"
  | "user_id"
  | "run_id"
  | "idempotency_key"
  | "scenario"
  | "clock";

export type E2EHarnessGuardResult =
  | { ok: true; metadata: E2EHarnessReplayMetadata }
  | {
      ok: false;
      reason: E2EHarnessGuardRejectReason;
      response: typeof E2E_HARNESS_GUARD_FAILURE_RESPONSE;
    };

export type E2EHarnessGuardOptions = E2EHarnessReplayDecisions & {
  now?: Date | number;
  maxJsonBytes?: number;
};

export interface E2EHarnessReplayBodyParseOptions {
  cookieUserId: string;
  now?: Date | number;
}

function reject(reason: E2EHarnessGuardRejectReason): E2EHarnessGuardResult {
  return { ok: false, reason, response: E2E_HARNESS_GUARD_FAILURE_RESPONSE };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactLoopbackOrigin(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  const port = Number(parsed.port);
  if (
    parsed.protocol !== "http:" ||
    parsed.hostname !== LOOPBACK_HOST ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65_535 ||
    parsed.origin !== `http://${LOOPBACK_HOST}:${port}`
  ) {
    return null;
  }

  return parsed.origin;
}

function readFixtureCookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (header === null) return null;

  const matches = header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${E2E_FIXTURE_COOKIE}=`));
  if (matches.length !== 1) return null;

  const encoded = matches[0]!.slice(E2E_FIXTURE_COOKIE.length + 1);
  let value: string;
  try {
    value = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  return E2E_FIXTURE_USER_ID_PATTERN.test(value) ? value : null;
}

function resolveNowMs(now: Date | number | undefined): number {
  const value = now instanceof Date ? now.getTime() : now ?? Date.now();
  return Number.isFinite(value) ? value : Number.NaN;
}

function validUtcClock(value: unknown, now: Date | number | undefined): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    return false;
  }

  const parsed = new Date(value);
  const parsedMs = parsed.getTime();
  const nowMs = resolveNowMs(now);
  return (
    Number.isFinite(parsedMs) &&
    Number.isFinite(nowMs) &&
    parsed.toISOString() === value &&
    parsedMs <= nowMs + E2E_HARNESS_CLOCK_FUTURE_TOLERANCE_MS
  );
}

function parseReplayBody(
  body: unknown,
  { cookieUserId, now }: E2EHarnessReplayBodyParseOptions,
): E2EHarnessGuardResult {
  if (!E2E_FIXTURE_USER_ID_PATTERN.test(cookieUserId)) return reject("fixture_cookie");
  if (!isRecord(body)) return reject("body_shape");

  const keys = Object.keys(body).sort();
  const expectedKeys = [...REPLAY_BODY_FIELDS].sort();
  if (keys.length !== expectedKeys.length) return reject("unknown_fields");
  if (keys.some((key, index) => key !== expectedKeys[index])) return reject("unknown_fields");

  const userId = body.userId;
  if (typeof userId !== "string" || userId !== cookieUserId || !E2E_FIXTURE_USER_ID_PATTERN.test(userId)) {
    return reject("user_id");
  }

  const runId = body.runId;
  if (typeof runId !== "string" || !E2E_REPLAY_RUN_ID_PATTERN.test(runId)) return reject("run_id");

  const idempotencyKey = body.idempotencyKey;
  if (
    typeof idempotencyKey !== "string" ||
    !E2E_REPLAY_IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)
  ) {
    return reject("idempotency_key");
  }

  const scenario = body.scenario;
  if (typeof scenario !== "string" || !E2E_REPLAY_SCENARIOS.includes(scenario as ReplayScenario)) {
    return reject("scenario");
  }
  if (!validUtcClock(body.clock, now)) return reject("clock");

  return {
    ok: true,
    metadata: {
      userId,
      runId,
      idempotencyKey,
      scenario: scenario as ReplayScenario,
      clock: body.clock,
      origin: "",
    },
  };
}

export function parseE2EHarnessReplayBody(
  body: unknown,
  options: E2EHarnessReplayBodyParseOptions,
): E2EHarnessGuardResult {
  return parseReplayBody(body, options);
}

async function readBoundedJson(request: Request, maxBytes: number): Promise<
  | { ok: true; body: unknown }
  | { ok: false; reason: "body_missing" | "body_too_large" | "body_encoding" | "body_json" }
> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && (!/^\d+$/u.test(contentLength) || Number(contentLength) > maxBytes)) {
    return { ok: false, reason: "body_too_large" };
  }
  if (!request.body) return { ok: false, reason: "body_missing" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return { ok: false, reason: "body_too_large" };
      }
      chunks.push(next.value);
    }
  } catch {
    return { ok: false, reason: "body_encoding" };
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, reason: "body_encoding" };
  }
  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, reason: "body_json" };
  }
}

export async function guardE2EHarnessReplayRequest(
  request: Request,
  options: E2EHarnessGuardOptions,
): Promise<E2EHarnessGuardResult> {
  const origin = exactLoopbackOrigin(request.url);
  if (!origin) return reject("origin");
  if (request.method !== "POST") return reject("method");
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return reject("content_type");
  }
  if (request.headers.get(E2E_TEST_MODE_HEADER) !== "1") return reject("test_mode_header");

  const cookieUserId = readFixtureCookie(request);
  if (!cookieUserId) return reject("fixture_cookie");
  if (options.networkDeny?.enabled !== true || options.networkDeny.failClosed !== true) {
    return reject("network_deny");
  }
  if (options.testMode?.enabled !== true || options.testMode.sentinel !== true) {
    return reject("test_mode_decision");
  }

  const maxJsonBytes = options.maxJsonBytes ?? E2E_HARNESS_REPLAY_MAX_JSON_BYTES;
  if (!Number.isInteger(maxJsonBytes) || maxJsonBytes < 1 || maxJsonBytes > E2E_HARNESS_REPLAY_MAX_JSON_BYTES) {
    return reject("body_too_large");
  }
  const parsed = await readBoundedJson(request, maxJsonBytes);
  if (!parsed.ok) return reject(parsed.reason);

  const bodyResult = parseReplayBody(parsed.body, { cookieUserId, now: options.now });
  if (!bodyResult.ok) return bodyResult;
  return { ok: true, metadata: { ...bodyResult.metadata, origin } };
}
