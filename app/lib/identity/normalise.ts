import { parse } from "tldts";
import { z } from "zod";

const NormalisedSubject = z.object({
  kind: z.enum(["domain", "handle", "channel"]),
  registrable: z.string().nullable(),
  url: z.string().nullable(),
  platform: z.string().optional(),
  handle: z.string().optional(),
  input: z.string(),
});
type NormalisedSubject = z.infer<typeof NormalisedSubject>;

const PLATFORM_HOSTS: Record<string, string> = {
  "youtube.com": "youtube",
  "youtu.be": "youtube",
  "instagram.com": "instagram",
  "tiktok.com": "tiktok",
  "twitter.com": "twitter",
  "x.com": "twitter",
  "facebook.com": "facebook",
  "fb.com": "facebook",
  "linkedin.com": "linkedin",
  "threads.net": "threads",
};

const HANDLE_RE = /^@?([A-Za-z0-9_.-]{1,64})$/;

type NormaliseResult =
  | { ok: true; subject: NormalisedSubject }
  | { ok: false; reason: string };

export function normaliseInput(raw: string): NormaliseResult {
  const input = raw.trim();
  if (!input) return { ok: false, reason: "empty" };

  if (input.startsWith("@")) {
    const m = HANDLE_RE.exec(input);
    if (!m) return { ok: false, reason: "not a handle" };
    return {
      ok: true,
      subject: { kind: "handle", registrable: null, url: null, handle: m[1].toLowerCase(), input },
    };
  }

  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input) ? input : `https://${input}`;
  if (!URL.canParse(withScheme)) return { ok: false, reason: "not a URL" };
  const url = new URL(withScheme);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "unsupported scheme" };
  }

  const host = url.hostname.toLowerCase();
  const parsed = parse(host, { allowPrivateDomains: false });
  if (!parsed.domain || parsed.isIp || host === "localhost") {
    return { ok: false, reason: "no registrable domain" };
  }

  const platform = PLATFORM_HOSTS[parsed.domain];
  const pathBits = url.pathname.split("/").filter(Boolean);

  if (platform) {
    const handleBit = pathBits.find((b) => b !== "user" && b !== "c" && b !== "channel");
    const handle = handleBit?.replace(/^@/, "");
    if (!handle || pathBits.length === 0) {
      return { ok: false, reason: "platform URL without a subject" };
    }
    const kind = platform === "youtube" ? "channel" : "handle";
    return {
      ok: true,
      subject: {
        kind,
        registrable: null,
        url: `https://${host}${url.pathname}`.replace(/\/$/, ""),
        platform,
        handle: handle.toLowerCase(),
        input,
      },
    };
  }

  const registrable = parsed.domain;
  return {
    ok: true,
    subject: { kind: "domain", registrable, url: `https://${registrable}/`, input },
  };
}
