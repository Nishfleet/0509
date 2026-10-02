import type { SiteFields } from "../identity/card-fields";
import type { Subject } from "../identity/normalise";
import { warmProposals } from "./generators/ai.server";

export async function warmDiscovery(subject: Subject, site: Promise<SiteFields>): Promise<void> {
  if (subject.kind !== "domain") return;
  const fields = await site;
  if (fields.unfound || fields.name === null || fields.name === "") return;
  await warmProposals({
    name: fields.name,
    domain: subject.registrable,
    description: fields.description === "" ? null : fields.description,
  });
}
