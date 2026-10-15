import { env } from "cloudflare:workers";

import { readUnsentOpenIncidentIds } from "../data/incident.server";

const GIVE_UP_AFTER_MS = 48 * 60 * 60 * 1000;
const GRACE_MS = 30 * 60 * 1000;

export async function requeueUnsentIncidentEmails(now: Date): Promise<number> {
  const ids = await readUnsentOpenIncidentIds({
    from: new Date(now.getTime() - GIVE_UP_AFTER_MS).toISOString(),
    until: new Date(now.getTime() - GRACE_MS).toISOString(),
  });
  for (const id of ids) await env.SEND_EMAIL.send({ incident_id: id });
  return ids.length;
}
