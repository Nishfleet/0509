import { env } from "cloudflare:workers";

import { sha256Hex } from "./sha256";

export async function isAdminEmail(email: string): Promise<boolean> {
  const allowed = env.ADMIN_EMAIL_HASHES.split(",")
    .map((hash) => hash.trim())
    .filter((hash) => hash !== "");
  if (allowed.length === 0) return false;
  return allowed.includes(await sha256Hex(email.trim().toLowerCase()));
}

export async function requireAdmin(email: string): Promise<void> {
  if (!(await isAdminEmail(email))) throw new Response("Not found", { status: 404 });
}
