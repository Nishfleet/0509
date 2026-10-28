export function pricingPathFor(requestUrl: string): string {
  return `/pricing${new URL(requestUrl).search}`;
}
