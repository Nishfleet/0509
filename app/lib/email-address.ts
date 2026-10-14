export function normalizeEmailAddress(address: string): string {
  return address.trim().toLowerCase();
}

export function looksLikeEmailAddress(address: string): boolean {
  return /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(address);
}
