const configuredWaitlistUrl = process.env.NEXT_PUBLIC_WAITLIST_URL?.trim();

export const WAITLIST_URL =
  configuredWaitlistUrl && configuredWaitlistUrl.length > 0
    ? configuredWaitlistUrl
    : "/waitlist";

export const hasExternalWaitlist = Boolean(configuredWaitlistUrl);
