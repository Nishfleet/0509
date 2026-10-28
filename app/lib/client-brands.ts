export const MAX_CLIENT_BRANDS = 25;

export function clientBrandsFullLine(): string {
  return `${String(MAX_CLIENT_BRANDS)} of ${String(MAX_CLIENT_BRANDS)} client brands used. Need more?`;
}
