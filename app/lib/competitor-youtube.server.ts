import { YOUTUBE_LINK_ERROR, youtubeLinkRefusal } from "./competitor-youtube";
import { replaceCompetitorYoutube } from "./data/entity.server";
import { normaliseSubject } from "./identity/normalise";

export async function saveCompetitorYoutube(
  workspaceId: string,
  entityId: string,
  raw: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const trimmed = raw.trim();
  const refusal = youtubeLinkRefusal(trimmed);
  if (refusal !== null) return { ok: false, message: refusal };
  const parsed = normaliseSubject(trimmed);
  const url = parsed.ok && parsed.subject.platform === "youtube" ? parsed.subject.url : null;
  if (url === null) return { ok: false, message: YOUTUBE_LINK_ERROR };
  const saved = await replaceCompetitorYoutube({ workspaceId, entityId, url });
  return saved ? { ok: true } : { ok: false, message: "We don't track that competitor." };
}
