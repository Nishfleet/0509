export const NAME_MAX = 80;

export const NAME_EMPTY_ERROR = "Type the name you want us to show for this competitor.";
export const NAME_TOO_LONG_ERROR = "That name is too long. Keep it under 80 characters.";

export function parseCompetitorName(raw: string): { ok: true; name: string } | { ok: false; message: string } {
  const name = raw.replace(/\s+/g, " ").trim();
  if (name === "") return { ok: false, message: NAME_EMPTY_ERROR };
  if (name.length > NAME_MAX) return { ok: false, message: NAME_TOO_LONG_ERROR };
  return { ok: true, name };
}
