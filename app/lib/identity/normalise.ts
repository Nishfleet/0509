import { getDomain } from "tldts";
import { z } from "zod";

export const SubjectSchema = z.object({
  kind: z.enum(["domain", "handle", "channel"]),
  registrable: z.string().min(1),
  url: z.string().url().nullable(),
  platform: z.enum(["youtube", "instagram", "tiktok", "x"]).optional(),
});

export type Subject = z.infer<typeof SubjectSchema>;

export type NormaliseResult =
  | { ok: true; subject: Subject }
  | { ok: false; reason: "empty" | "unparseable" | "no-registrable-domain" | "unsupported-platform" };

const HANDLE = /^[A-Za-z0-9._-]{1,50}$/;

function ok(subject: z.input<typeof SubjectSchema>): NormaliseResult {
  return { ok: true, subject: SubjectSchema.parse(subject) };
}

function fail(reason: Extract<NormaliseResult, { ok: false }>["reason"]): NormaliseResult {
  return { ok: false, reason };
}

function socialHandle(
  segment: string,
  platform: "instagram" | "tiktok" | "x",
  url: (handle: string) => string,
): NormaliseResult {
  const h = segment.replace(/^@/, "").toLowerCase();
  return ok({ kind: "handle", registrable: h, url: url(h), platform });
}

export function normaliseSubject(input: string): NormaliseResult {
  const s = input.trim();
  if (s === "") return fail("empty");

  if (s.startsWith("@")) {
    const h = s.slice(1);
    if (!HANDLE.test(h)) return fail("unparseable");
    return ok({ kind: "handle", registrable: h.toLowerCase(), url: null });
  }

  const candidate = URL.canParse(s) ? s : `https://${s}`;
  if (!URL.canParse(candidate)) return fail("unparseable");
  const u = new URL(candidate);
  if (u.protocol !== "http:" && u.protocol !== "https:") return fail("unparseable");

  const reg = getDomain(u.hostname);
  if (reg === null) return fail("no-registrable-domain");

  const seg = u.pathname.split("/").filter(Boolean);

  if (reg === "youtube.com") {
    const head = seg[0];
    if (head?.startsWith("@")) {
      return ok({
        kind: "channel",
        platform: "youtube",
        registrable: head.slice(1).toLowerCase(),
        url: `https://www.youtube.com/${head}`,
      });
    }
    if ((head === "user" || head === "c") && seg[1]) {
      return ok({
        kind: "channel",
        platform: "youtube",
        registrable: seg[1].toLowerCase(),
        url: `https://www.youtube.com/${head}/${seg[1]}`,
      });
    }
    if (head === "channel" && seg[1]) {
      return ok({
        kind: "channel",
        platform: "youtube",
        registrable: seg[1],
        url: `https://www.youtube.com/${head}/${seg[1]}`,
      });
    }
    return fail("unsupported-platform");
  }

  if (reg === "instagram.com") {
    if (!seg[0]) return fail("unsupported-platform");
    return socialHandle(seg[0], "instagram", (h) => `https://www.instagram.com/${h}/`);
  }
  if (reg === "tiktok.com") {
    if (!seg[0]) return fail("unsupported-platform");
    return socialHandle(seg[0], "tiktok", (h) => `https://www.tiktok.com/@${h}`);
  }
  if (reg === "x.com" || reg === "twitter.com") {
    if (!seg[0]) return fail("unsupported-platform");
    return socialHandle(seg[0], "x", (h) => `https://x.com/${h}`);
  }

  return ok({ kind: "domain", registrable: reg, url: `https://${u.hostname}/` });
}
