const UNIDENTIFIED_KEY = "ip:absent";

export function clientIp(request: Request): string | null {
  return request.headers.get("cf-connecting-ip");
}

export async function withinLimit(limit: RateLimit, ip: string | null): Promise<boolean> {
  const { success } = await limit.limit({ key: ip === null ? UNIDENTIFIED_KEY : `ip:${ip}` });
  return success;
}
