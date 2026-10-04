// The node project holds pure logic; fetchOutbound reads an optional signing key from env, and
// an empty env means "no key", so requests go out unsigned.
export const env: Record<string, never> = {};
