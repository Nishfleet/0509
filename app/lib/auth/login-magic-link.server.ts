import { magicLinkRequestURL } from "./magic-link-path";

export function formMagicLinkRequest(
  authUrl: string,
  request: Request,
  email: string,
  captcha: string,
  callbackURL: string,
): Request {
  const endpoint = magicLinkRequestURL(authUrl);
  const headers = new Headers();
  headers.set("content-type", "application/json");
  headers.set("origin", endpoint.origin);
  const ip = request.headers.get("cf-connecting-ip");
  if (ip !== null && ip.length > 0) headers.set("cf-connecting-ip", ip);
  if (captcha.length > 0) headers.set("x-captcha-response", captcha);
  return new Request(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, callbackURL }),
  });
}
