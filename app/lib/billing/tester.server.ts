import { env } from "cloudflare:workers";

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function isTester(email: string): Promise<boolean> {
  const allowed = env.TESTER_EMAIL_HASHES.split(",")
    .map((hash) => hash.trim())
    .filter((hash) => hash !== "");
  if (allowed.length === 0) return false;
  return allowed.includes(await sha256Hex(email.trim().toLowerCase()));
}
