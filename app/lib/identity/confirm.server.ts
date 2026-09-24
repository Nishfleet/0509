import { insertSelfEntity } from "../data/entity.server";
import { startDiscovery } from "../discovery/start.server";
import { confirmSchema, readConfirmFields } from "./confirm-fields";
import { normaliseSubject } from "./normalise";

export async function confirmCard(workspaceId: string, form: FormData): Promise<boolean> {
  const parsed = confirmSchema.safeParse(readConfirmFields(form));
  if (!parsed.success) return false;
  const normalised = normaliseSubject(parsed.data.subject);
  if (!normalised.ok) return false;
  const { subject } = normalised;
  const card = parsed.data;
  const now = new Date();
  await insertSelfEntity({
    id: crypto.randomUUID(),
    workspaceId,
    domain: subject.registrable,
    name: card.name,
    identityJson: JSON.stringify({
      kind: subject.kind,
      platform: subject.platform ?? null,
      url: subject.url,
      description: card.description === "" ? null : card.description,
      logoUrl: card.logo === "" ? null : card.logo,
      socials: card.socials,
    }),
    now: now.toISOString(),
  });
  await startDiscovery(workspaceId, now);
  return true;
}
