export function domainFromInput(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^www\./, "");
  const host = (withoutScheme.split(/[\s/?#@]/)[0] ?? "").replace(/^\.+|\.+$/g, "");
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) return null;
  return host;
}
