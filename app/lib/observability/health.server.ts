import { captureException } from "@sentry/cloudflare";

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

export async function healthResponse(db: D1Database): Promise<Response> {
  const timestamp = new Date().toISOString();
  try {
    const row = await firstOrTimeout(db.prepare("SELECT 1 AS ok").first<{ ok: number }>());
    if (row?.ok !== 1) {
      return Response.json({ status: "error", app: "0509", d1: "error", timestamp }, { status: 503 });
    }
  } catch (error) {
    captureException(error);
    return Response.json({ status: "error", app: "0509", d1: "error", timestamp }, { status: 503 });
  }
  return Response.json({ status: "ok", app: "0509", d1: "ok", timestamp });
}
