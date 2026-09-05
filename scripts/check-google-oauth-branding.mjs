#!/usr/bin/env node

const baseUrl = process.env.PUBLIC_HOME_URL ?? "https://0509.io";
const loginUrl = new URL("/auth/login", baseUrl);
const oauthUrl = new URL("/auth/better/oauth", baseUrl);
const maxRedirects = 8;

const expectedBrandPatterns = [/\b0509\b/i, /five\s+to\s+nine/i];
const forbiddenBrandPatterns = [/better-auth\.com/i, /\bbetter\s+auth\b/i];
const googleErrorPatterns = [
  /\berror\s+4\d\d\b/i,
  /\bredirect_uri_mismatch\b/i,
  /\binvalid_request\b/i,
  /\baccess_denied\b/i,
  /\bapp\s+blocked\b/i,
  /\boauth\s+error\b/i,
];

function redactUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "[invalid-url]";
  }
}

function textFromHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function googleButtonVisible(html) {
  return (
    /Continue with Google/i.test(html) ||
    /name=["']provider["'][^>]*value=["']google["']/i.test(html)
  );
}

async function fetchWithTimeout(url, init = {}) {
  return fetch(url, {
    ...init,
    headers: {
      "cache-control": "no-cache",
      pragma: "no-cache",
      "user-agent": "0509-google-oauth-brand-canary/1.0",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
}

async function readLoginPage() {
  const response = await fetchWithTimeout(loginUrl);
  const html = await response.text();
  if (!response.ok) {
    throw new Error(`login page returned HTTP ${response.status}`);
  }
  return html;
}

async function startGoogleOAuth() {
  return fetchWithTimeout(oauthUrl, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: new URL(baseUrl).origin,
    },
    body: new URLSearchParams({
      mode: "login",
      provider: "google",
      redirectTo: "/app",
    }),
  });
}

function isDisabledRedirect(response) {
  const location = response.headers.get("location") ?? "";
  return (
    response.status >= 300 &&
    response.status < 400 &&
    location.includes("error=oauth_not_configured")
  );
}

async function followToGoogle(startResponse) {
  let currentUrl = new URL(startResponse.headers.get("location") ?? "", oauthUrl).toString();

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    if (!currentUrl) {
      throw new Error("OAuth start did not provide a redirect location.");
    }

    const response = await fetchWithTimeout(currentUrl, { redirect: "manual" });
    const responseUrl = new URL(response.url || currentUrl);
    const contentType = response.headers.get("content-type") ?? "";
    const location = response.headers.get("location");

    if (response.status >= 300 && response.status < 400 && location) {
      currentUrl = new URL(location, responseUrl).toString();
      continue;
    }

    if (responseUrl.hostname === "accounts.google.com" && contentType.includes("text/html")) {
      return {
        html: await response.text(),
        status: response.status,
        url: responseUrl.toString(),
      };
    }

    throw new Error(
      `OAuth redirect chain stopped at ${redactUrl(responseUrl.toString())} with HTTP ${response.status}`,
    );
  }

  throw new Error("OAuth redirect chain exceeded the redirect limit before reaching Google.");
}

function assertGoogleBranding(page) {
  const text = textFromHtml(page.html);
  const googleErrorMatches = googleErrorPatterns
    .filter((pattern) => pattern.test(text))
    .map((pattern) => pattern.source);
  const hasExpectedBrand = expectedBrandPatterns.some((pattern) => pattern.test(text));
  const forbiddenMatches = forbiddenBrandPatterns
    .filter((pattern) => pattern.test(text))
    .map((pattern) => pattern.source);

  if (page.status < 200 || page.status >= 300 || googleErrorMatches.length > 0) {
    const snippet = text.slice(0, 700);
    throw new Error(
      [
        "Google OAuth account page did not load successfully.",
        `google status: ${page.status}`,
        `google oauth error present: ${googleErrorMatches.length > 0}`,
        `google url: ${redactUrl(page.url)}`,
        `page snippet: ${snippet}`,
      ].join("\n"),
    );
  }

  if (!hasExpectedBrand || forbiddenMatches.length > 0) {
    const snippet = text.slice(0, 700);
    throw new Error(
      [
        "Google OAuth branding check failed.",
        `expected 0509/Five to Nine brand: ${hasExpectedBrand}`,
        `forbidden auth-provider branding present: ${forbiddenMatches.length > 0}`,
        `google status: ${page.status}`,
        `google url: ${redactUrl(page.url)}`,
        `page snippet: ${snippet}`,
      ].join("\n"),
    );
  }
}

async function run() {
  const loginHtml = await readLoginPage();
  const hasGoogleButton = googleButtonVisible(loginHtml);
  const startResponse = await startGoogleOAuth();

  if (isDisabledRedirect(startResponse)) {
    if (hasGoogleButton) {
      throw new Error("Google button is visible, but the OAuth start endpoint is disabled.");
    }
    console.log("google oauth brand check skipped: provider hidden and disabled");
    return;
  }

  if (!hasGoogleButton) {
    throw new Error("Google OAuth start is enabled, but the login page does not show Google.");
  }
  if (startResponse.status < 300 || startResponse.status >= 400) {
    throw new Error(`Google OAuth start returned HTTP ${startResponse.status}`);
  }

  const googlePage = await followToGoogle(startResponse);
  assertGoogleBranding(googlePage);
  console.log("google oauth brand check passed");
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
