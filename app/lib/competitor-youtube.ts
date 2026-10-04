export const YOUTUBE_LINK_MAX = 200;

export const YOUTUBE_LINK_ERROR =
  "That isn't a YouTube channel link. Paste the channel page, like youtube.com/@theirname.";
export const YOUTUBE_VIDEO_ERROR =
  "That looks like a video. Paste the channel link, not a video, like youtube.com/@theirname.";
export const YOUTUBE_TOO_LONG_ERROR =
  "That link is too long. Paste just the channel link, like youtube.com/@theirname.";

const VIDEO_PATH = /^\/(?:watch|shorts|live|embed|playlist|v)(?:\/|$)/;

function looksLikeVideo(raw: string): boolean {
  const candidate = URL.canParse(raw) ? raw : `https://${raw}`;
  if (!URL.canParse(candidate)) return false;
  const { hostname, pathname } = new URL(candidate);
  return hostname.toLowerCase() === "youtu.be" || VIDEO_PATH.test(pathname);
}

export function youtubeLinkRefusal(raw: string): string | null {
  if (raw.length > YOUTUBE_LINK_MAX) return YOUTUBE_TOO_LONG_ERROR;
  return looksLikeVideo(raw) ? YOUTUBE_VIDEO_ERROR : null;
}
