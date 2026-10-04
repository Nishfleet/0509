import { env } from "cloudflare:workers";

import type { SiteFields } from "../identity/card-fields";
import type { Subject } from "../identity/normalise";
import { warmProposals } from "./generators/ai.server";

const WARMS_PER_WORKSPACE_PER_DAY = 30;

function takeWarm(workspaceId: string): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const id = env.BROWSER_BUDGET.idFromName(`warm:${workspaceId}:${day}`);
  return env.BROWSER_BUDGET.get(id).take(WARMS_PER_WORKSPACE_PER_DAY);
}

export async function warmDiscovery(workspaceId: string, subject: Subject, site: Promise<SiteFields>): Promise<void> {
  if (subject.kind !== "domain") return;
  const fields = await site;
  if (fields.unfound || fields.name === null || fields.name === "") return;
  if (!(await takeWarm(workspaceId))) return;
  await warmProposals({
    name: fields.name,
    domain: subject.registrable,
    description: fields.description === "" ? null : fields.description,
  });
}
