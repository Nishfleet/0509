import { captureException } from "@sentry/cloudflare";
import { env } from "cloudflare:workers";

const D1_PING_TIMEOUT_MS = 2_000;

function firstOrTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("d1-ping-timeout"));
    }, D1_PING_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function failed(timestamp: string, commit: string): Response {
  return Response.json({ status: "error", app: "0509", d1: "error", timestamp, commit }, { status: 503 });
}

export async function healthResponse(db: D1Database, commit: string): Promise<Response> {
  const timestamp = new Date().toISOString();
  try {
    const row = await firstOrTimeout(db.prepare("SELECT 1 AS ok").first<{ ok: number }>());
    if (row?.ok !== 1) {
      return failed(timestamp, commit);
    }
  } catch (error) {
    captureException(error);
    return failed(timestamp, commit);
  }
  return Response.json({ status: "ok", app: "0509", d1: "ok", timestamp, commit });
}

export function currentHealthResponse(): Promise<Response> {
  return healthResponse(env.DB, env.GIT_SHA);
}
