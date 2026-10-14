import type { BriefPayload } from "./brief-payload";
import { neutralizeBareUrls, slackEscape } from "./slack-webhook";

const BRIEF_LINK = "https://0509.io/app/brief";
const MAX_MARKS = 3;

function movementPhrase(payload: BriefPayload): string | null {
  if (payload.headline_is_new) return "your first ranking";
  const movement = payload.headline_movement;
  if (movement === null) return null;
  if (movement > 0) return `up ${String(movement)}`;
  if (movement < 0) return `down ${String(Math.abs(movement))}`;
  return "holding steady";
}

function headline(payload: BriefPayload): string {
  const { headline_rank: rank, headline_total: others } = payload;
  if (payload.is_unjudged) return "Your weekly brief";
  if (rank === null || others < 2) return "Your weekly brief";
  const moved = movementPhrase(payload);
  const base = `You're #${String(rank)} of ${String(others)} this week`;
  return moved === null ? base : `${base} (${moved})`;
}

function safe(text: string): string {
  return neutralizeBareUrls(slackEscape(text));
}

export function slackBriefText(payload: BriefPayload): string {
  const marks = payload.read_this_first.slice(0, MAX_MARKS).map((mark) => {
    const title = mark.title === "" ? mark.source : mark.title;
    return `• ${safe(mark.entity_name)}: ${safe(title)}`;
  });
  return [
    `*${safe(headline(payload))}*`,
    safe(payload.why_line),
    ...(marks.length === 0 ? [] : ["", ...marks]),
    "",
    `<${BRIEF_LINK}|Open the full brief in Five to Nine>`,
  ].join("\n");
}
