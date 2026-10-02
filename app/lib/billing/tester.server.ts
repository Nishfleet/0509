import { env } from "cloudflare:workers";

import { sha256Hex } from "../sha256";

export async function isTester(email: string): Promise<boolean> {
  const allowed = env.TESTER_EMAIL_HASHES.split(",")
    .map((hash) => hash.trim())
    .filter((hash) => hash !== "");
  if (allowed.length === 0) return false;
  return allowed.includes(await sha256Hex(email.trim().toLowerCase()));
}
