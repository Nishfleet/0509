export function clientIp(request: Request): string | null {
  return request.headers.get("cf-connecting-ip");
}

export async function withinLimit(limit: RateLimit, ip: string | null): Promise<boolean> {
  if (ip === null) return true;
  const { success } = await limit.limit({ key: `ip:${ip}` });
  return success;
}
