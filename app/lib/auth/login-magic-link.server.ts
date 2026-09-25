export function formMagicLinkRequest(
  authUrl: string,
  request: Request,
  email: string,
  captcha: string,
  callbackURL: string,
): Request {
  const site = new URL(authUrl);
  const headers = new Headers();
  headers.set("content-type", "application/json");
  headers.set("origin", site.origin);
  for (const name of ["cf-connecting-ip", "cf-access-jwt-assertion", "cookie"]) {
    const value = request.headers.get(name);
    if (value !== null && value.length > 0) headers.set(name, value);
  }
  if (captcha.length > 0) headers.set("x-captcha-response", captcha);
  return new Request(new URL("/api/auth/sign-in/magic-link", site), {
    method: "POST",
    headers,
    body: JSON.stringify({ email, callbackURL }),
  });
}
