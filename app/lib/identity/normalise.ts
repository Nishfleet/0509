import { getDomain } from "tldts";
import { z } from "zod";

export const SubjectSchema = z.object({
  kind: z.enum(["domain", "handle", "channel"]),
  registrable: z.string().min(1),
  url: z.url().nullable(),
  platform: z.enum(["youtube", "instagram", "tiktok", "x"]).optional(),
});

export type Subject = z.infer<typeof SubjectSchema>;

export type NormaliseResult =
  | { ok: true; subject: Subject }
  | { ok: false; reason: "empty" | "unparseable" | "no-registrable-domain" | "unsupported-platform" };

const HANDLE = /^[A-Za-z0-9._-]{1,50}$/;

const LOGIN_HOSTS = new Set(["accounts.google.com"]);

const LOGIN_PATHS = new Set(["/login", "/signin", "/sign-in", "/accounts/login", "/i/flow/login"]);

export function isLoginWall(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.startsWith("@")) return false;
  const candidate = URL.canParse(trimmed) ? trimmed : `https://${trimmed}`;
  if (!URL.canParse(candidate)) return false;
  const url = new URL(candidate);
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (LOGIN_HOSTS.has(url.hostname)) return true;
  const path = url.pathname.length > 1 && url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  return LOGIN_PATHS.has(path.toLowerCase());
}

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

const SOCIAL_HOSTS: ReadonlyMap<string, { platform: "instagram" | "tiktok" | "x"; url: (handle: string) => string }> =
  new Map([
    ["instagram.com", { platform: "instagram", url: (h) => `https://www.instagram.com/${h}/` }],
    ["tiktok.com", { platform: "tiktok", url: (h) => `https://www.tiktok.com/@${h}` }],
    ["x.com", { platform: "x", url: (h) => `https://x.com/${h}` }],
    ["twitter.com", { platform: "x", url: (h) => `https://x.com/${h}` }],
  ]);

function parseWebUrl(s: string): URL | null {
  const candidate = URL.canParse(s) ? s : `https://${s}`;
  if (!URL.canParse(candidate)) return null;
  const u = new URL(candidate);
  return u.protocol === "http:" || u.protocol === "https:" ? u : null;
}

function youtubeSubject(seg: string[]): NormaliseResult {
  const head = seg[0];
  if (head?.startsWith("@")) {
    return ok({
      kind: "channel",
      platform: "youtube",
      registrable: head.slice(1).toLowerCase(),
      url: `https://www.youtube.com/${head}`,
    });
  }
  const name = seg[1];
  if (!name) return fail("unsupported-platform");
  if (head === "user" || head === "c") {
    return ok({
      kind: "channel",
      platform: "youtube",
      registrable: name.toLowerCase(),
      url: `https://www.youtube.com/${head}/${name}`,
    });
  }
  if (head === "channel") {
    return ok({
      kind: "channel",
      platform: "youtube",
      registrable: name,
      url: `https://www.youtube.com/${head}/${name}`,
    });
  }
  return fail("unsupported-platform");
}

export function normaliseSubject(input: string): NormaliseResult {
  const s = input.trim();
  if (s === "") return fail("empty");

  if (s.startsWith("@")) {
    const h = s.slice(1);
    if (!HANDLE.test(h)) return fail("unparseable");
    return ok({ kind: "handle", registrable: h.toLowerCase(), url: null });
  }

  const u = parseWebUrl(s);
  if (u === null) return fail("unparseable");

  const reg = getDomain(u.hostname);
  if (reg === null) return fail("no-registrable-domain");

  const seg = u.pathname.split("/").filter(Boolean);

  if (reg === "youtube.com") return youtubeSubject(seg);

  const social = SOCIAL_HOSTS.get(reg);
  if (social !== undefined) {
    return seg[0] ? socialHandle(seg[0], social.platform, social.url) : fail("unsupported-platform");
  }

  return ok({ kind: "domain", registrable: reg, url: `https://${u.hostname}/` });
}
