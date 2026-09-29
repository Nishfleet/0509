import { sha256Hex } from "../sha256";

export interface SignInLimits {
  SIGN_IN_EMAIL_LIMIT: RateLimit;
  SIGN_IN_IP_LIMIT: RateLimit;
}

async function addressKey(email: string): Promise<string> {
  return `email:${await sha256Hex(email.trim().toLowerCase())}`;
}

export async function signInLinkAllowed(limits: SignInLimits, email: string, ip: string | null): Promise<boolean> {
  const checks = [
    limits.SIGN_IN_EMAIL_LIMIT.limit({ key: await addressKey(email) }),
    ...(ip ? [limits.SIGN_IN_IP_LIMIT.limit({ key: `ip:${ip}` })] : []),
  ];
  const outcomes = await Promise.all(checks);
  return outcomes.every((outcome) => outcome.success);
}
