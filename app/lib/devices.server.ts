import { env } from "cloudflare:workers";

import { readDevices } from "./data/session.server";
import { deviceLabel, type DeviceItem } from "./device-label";
import { APP_LOCALE } from "./locale";

const DAY = new Intl.DateTimeFormat(APP_LOCALE, { timeZone: "UTC", day: "numeric", month: "short" });

export async function readDeviceList(
  userId: string,
  currentSessionId: string,
  now: Date,
): Promise<DeviceItem[]> {
  const rows = await readDevices(env.DB, userId, now);
  return rows.map((row) => {
    const touched = new Date(row.updatedAt);
    return {
      id: row.id,
      label: deviceLabel(row.userAgent),
      lastActive: Number.isNaN(touched.getTime()) ? null : DAY.format(touched),
      current: row.id === currentSessionId,
    };
  });
}
