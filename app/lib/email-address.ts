export function normalizeEmailAddress(address: string): string {
  return address.trim().replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}
