export const MENTIONS_SWEEP_CRON = "0 1 * * *";
export const SITE_SWEEP_UTC_HOUR = 2;
export const SITE_SWEEP_CRON = `0 ${String(SITE_SWEEP_UTC_HOUR)} * * *`;
export const SITE_SWEEP_UTC_LABEL = `${String(SITE_SWEEP_UTC_HOUR).padStart(2, "0")}:00 UTC`;
export const OWN_SITE_CHECK_CRON = "0 * * * *";
export const NIGHTLY_CRON = "0 3 * * *";
export const WEEKLY_REFRESH_CRON = "0 4 * * 1";
