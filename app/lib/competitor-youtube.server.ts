import { readCompetitorSocials, setCompetitorSocials } from "./data/entity.server";
import { normaliseSubject } from "./identity/normalise";

export const YOUTUBE_LINK_ERROR =
  "That isn't a YouTube channel link. Paste the channel page, like youtube.com/@theirname.";

export async function saveCompetitorYoutube(
  workspaceId: string,
  entityId: string,
  raw: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const parsed = normaliseSubject(raw);
  const url = parsed.ok && parsed.subject.platform === "youtube" ? parsed.subject.url : null;
  if (url === null) return { ok: false, message: YOUTUBE_LINK_ERROR };
  const socials = await readCompetitorSocials(workspaceId, entityId);
  if (socials === null) return { ok: false, message: "We don't track that competitor." };
  await setCompetitorSocials({
    workspaceId,
    entityId,
    socials: [...socials.filter((social) => social.platform !== "youtube"), { platform: "youtube", url }],
  });
  return { ok: true };
}
