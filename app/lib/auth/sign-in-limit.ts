export interface SignInLimits {
  SIGN_IN_EMAIL_LIMIT: RateLimit;
  SIGN_IN_IP_LIMIT: RateLimit;
}

async function addressKey(email: string): Promise<string> {
  const bytes = new TextEncoder().encode(email.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `email:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function signInLinkAllowed(
  limits: SignInLimits,
  email: string,
  ip: string | null,
): Promise<boolean> {
  const checks = [
    limits.SIGN_IN_EMAIL_LIMIT.limit({ key: await addressKey(email) }),
    ...(ip ? [limits.SIGN_IN_IP_LIMIT.limit({ key: `ip:${ip}` })] : []),
  ];
  const outcomes = await Promise.all(checks);
  return outcomes.every((outcome) => outcome.success);
}
