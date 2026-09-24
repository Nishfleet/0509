import { insertSelfEntity } from "../data/entity.server";
import { startDiscovery } from "../discovery/start.server";
import { confirmSchema, readConfirmFields } from "./confirm-fields";
import { normaliseSubject } from "./normalise";
import { readLogo } from "./logo-store.server";

export async function confirmCard(workspaceId: string, form: FormData): Promise<boolean> {
  const parsed = confirmSchema.safeParse(readConfirmFields(form));
  if (!parsed.success) return false;
  const normalised = normaliseSubject(parsed.data.subject);
  if (!normalised.ok) return false;
  const { subject } = normalised;
  const card = parsed.data;
  const id = crypto.randomUUID();
  const logoUrl = (await readLogo(subject.registrable)) !== null ? `/app/logos/${id}` : null;
  const now = new Date();
  await insertSelfEntity({
    id,
    workspaceId,
    domain: subject.registrable,
    name: card.name,
    identityJson: JSON.stringify({
      kind: subject.kind,
      platform: subject.platform ?? null,
      url: subject.url,
      description: card.description === "" ? null : card.description,
      logoUrl,
      socials: card.socials,
    }),
    now: now.toISOString(),
  });
  await startDiscovery(workspaceId, now);
  return true;
}
