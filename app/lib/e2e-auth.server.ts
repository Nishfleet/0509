import type { AppEnv } from "~/lib/env.server";
import type { AppSession } from "~/lib/types";

export const E2E_TEST_SESSION_COOKIE = "f9_e2e_fixture";
export const E2E_TEST_MODE_HEADER = "x-0509-e2e-test-mode";

const E2E_USER_ID_PATTERN = /^e2e-[a-z0-9-]{3,80}$/;
const E2E_SESSION_ID_PATTERN = /^e2e-session-e2e-[a-z0-9-]{3,80}$/;
const PRODUCTION_HOST_PATTERN = /(^|\.)0509\.(io|in)$/i;
const LOCAL_TEST_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

type ProcessEnvCarrier = typeof globalThis & {
  process?: {
    env?: Record<string, string | undefined>;
  };
};

function processEnvFlag(name: string) {
  return (globalThis as ProcessEnvCarrier).process?.env?.[name]?.trim();
}

function envFlag(env: AppEnv, name: keyof AppEnv) {
  const value = env[name];
  return typeof value === "string" ? value.trim() : "";
}

function isEnabled(value: string | undefined) {
  return value === "1" || value?.toLowerCase() === "true";
}

function requestFlag(request: Request) {
  return request.headers.get(E2E_TEST_MODE_HEADER)?.trim();
}

export function isE2ETestAuthEnabled(env: AppEnv, request: Request) {
  const url = new URL(request.url);
  const hostname = url.hostname.toLowerCase();
  const testModeEnabled =
    isEnabled(envFlag(env, "E2E_TEST_MODE")) ||
    isEnabled(processEnvFlag("E2E_TEST_MODE")) ||
    isEnabled(requestFlag(request));

  return (
    testModeEnabled &&
    LOCAL_TEST_HOSTS.has(hostname) &&
    !PRODUCTION_HOST_PATTERN.test(hostname)
  );
}

export function readE2ETestFixtureUserId(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${E2E_TEST_SESSION_COOKIE}=`));
  const rawValue = cookie?.slice(E2E_TEST_SESSION_COOKIE.length + 1) ?? "";
  let value = "";
  try {
    value = decodeURIComponent(rawValue).trim();
  } catch {
    return null;
  }

  return E2E_USER_ID_PATTERN.test(value) ? value : null;
}

export function isE2ETestSessionId(sessionId: string | null | undefined) {
  return Boolean(sessionId && E2E_SESSION_ID_PATTERN.test(sessionId));
}

export async function getE2ETestSession(
  env: AppEnv,
  request: Request,
): Promise<AppSession | null> {
  if (!isE2ETestAuthEnabled(env, request) || !env.DB) {
    return null;
  }

  const userId = readE2ETestFixtureUserId(request);
  if (!userId) {
    return null;
  }

  const user = await env.DB.prepare(
    "SELECT id, email, name, image, onboardedAt FROM user WHERE id = ? LIMIT 1",
  )
    .bind(userId)
    .first<{
      id: string;
      email: string;
      name: string;
      image: string | null;
      onboardedAt: string | null;
    }>();

  if (!user) {
    return null;
  }

  return {
    session: {
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      id: `e2e-session-${user.id}`,
      userId: user.id,
    },
    user: {
      email: user.email,
      id: user.id,
      image: user.image,
      name: user.name,
      onboardedAt: user.onboardedAt,
    },
  };
}
