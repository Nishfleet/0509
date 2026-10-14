import type { RenderedBrief } from "../../app/lib/brief-payload";
import { escapeHtml } from "../../app/lib/html";
import { nudgeSubject } from "../../app/lib/rival-nudge";
import { renderAlertFooter, type AlertFooterContext } from "./alert-footer";
import { EYEBROW, FONT, emailDocument } from "./email-shell";

export interface RivalNudgeContext {
  rivals: number;
  rival_name: string | null;
  link: string;
  footer: AlertFooterContext;
}

const HEADLINE = `margin:0;font-family:${FONT};font-size:24px;line-height:30px;font-weight:800;letter-spacing:-0.02em;`;
const BODY = `margin:12px 0 0;font-family:${FONT};font-size:16px;line-height:24px;`;
const OPEN = "Add a rival";

function lines(ctx: RivalNudgeContext): string[] {
  const watching =
    ctx.rivals === 0 || ctx.rival_name === null
      ? "You are not watching a rival yet, so there is nobody to rank you against."
      : `You are watching ${ctx.rival_name}, so your ranking compares you with one rival.`;
  return [watching, "Each rival you add is read the same way and joins your weekly ranking and brief."];
}

export function renderRivalNudge(ctx: RivalNudgeContext): RenderedBrief {
  const subject = nudgeSubject(ctx.rivals);
  const body = lines(ctx);
  const href = escapeHtml(ctx.link);
  const footer = renderAlertFooter(ctx.footer);
  return {
    subject,
    text: [subject, ...body, `${OPEN}: ${ctx.link}`, footer.text].join("\n\n"),
    html: emailDocument(
      subject,
      [
        `<p class="brief-muted" style="${EYEBROW}">Your rivals</p>`,
        `<p style="${HEADLINE}">${escapeHtml(subject)}</p>`,
        ...body.map((line) => `<p style="${BODY}">${escapeHtml(line)}</p>`),
        `<p style="${BODY}"><a class="brief-ink" href="${href}">${OPEN}</a></p>`,
        footer.html,
      ].join(""),
      body[0],
    ),
  };
}
