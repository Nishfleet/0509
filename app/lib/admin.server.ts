import { env } from "cloudflare:workers";

import { z } from "zod";

import { sha256Hex } from "./sha256";

const adminHashes = () => z.string().default("").parse(Reflect.get(env, "ADMIN_EMAIL_HASHES"));

export async function isAdminEmail(email: string): Promise<boolean> {
  const allowed = adminHashes()
    .split(",")
    .map((hash) => hash.trim())
    .filter((hash) => hash !== "");
  if (allowed.length === 0) return false;
  return allowed.includes(await sha256Hex(email.trim().toLowerCase()));
}

export async function requireAdmin(user: { email: string; emailVerified: boolean }): Promise<void> {
  if (!user.emailVerified || !(await isAdminEmail(user.email))) throw new Response("Not found", { status: 404 });
}
