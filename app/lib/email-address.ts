export function normalizeEmailAddress(address: string): string {
  return address.trim().toLowerCase();
}

export function looksLikeEmailAddress(address: string): boolean {
  const at = address.indexOf("@");
  return at >= 1 && at === address.lastIndexOf("@") && at < address.length - 1;
}
