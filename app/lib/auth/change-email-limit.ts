import { sha256Hex } from "../sha256";

export async function changeEmailAllowed(limit: RateLimit, userId: string, newEmail: string): Promise<boolean> {
  const outcomes = await Promise.all([
    limit.limit({ key: `user:${userId}` }),
    limit.limit({ key: `email:${await sha256Hex(newEmail.trim().toLowerCase())}` }),
  ]);
  return outcomes.every((outcome) => outcome.success);
}
