export function requireExactReleaseBaseURL(baseURL: string | undefined) {
  if (!baseURL) throw new Error("missing_release_base_url");
  let parsed: URL;
  try {
    parsed = new URL(baseURL);
  } catch {
    throw new Error("invalid_release_base_url");
  }
  const port = Number(parsed.port);
  if (
    parsed.protocol !== "http:" ||
    parsed.hostname !== "127.0.0.1" ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password ||
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65_535 ||
    parsed.origin !== baseURL
  ) {
    throw new Error("invalid_release_base_url");
  }
  return parsed.origin;
}
