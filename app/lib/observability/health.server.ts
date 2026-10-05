import { captureException } from "@sentry/cloudflare";

export async function healthResponse(db: D1Database): Promise<Response> {
  const timestamp = new Date().toISOString();
  try {
    const row = await db.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    if (row === null || row.ok !== 1) {
      return Response.json({ status: "error", app: "0509", d1: "error", timestamp }, { status: 503 });
    }
  } catch (error) {
    captureException(error);
    return Response.json({ status: "error", app: "0509", d1: "error", timestamp }, { status: 503 });
  }
  return Response.json({ status: "ok", app: "0509", d1: "ok", timestamp });
}
