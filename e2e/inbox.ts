import { expect, type Page } from "@playwright/test";

// The J1/J2 mail path, per the amended decision on 0509#3927: Email Routing
// delivers e2e@0509.io mail to the 0509-e2e-inbox Worker, which stores the raw
// message in KV for an hour and serves it back on this one endpoint, gated by
// the E2E_INBOX_TOKEN secret. Nothing here reads D1 and nothing shortens the
// auth path — the link the test clicks is the link the app really sent.
const INBOX_URL = "https://e2e-inbox.0509.io";
const POLL_LIMIT_MS = 120_000;
const POLL_INTERVAL_MS = 3_000;

// Fail loudly, never skip: the amended decision on #3927 requires a missing
// secret or routing rule to name itself in the failure. In the production lane
// an absent env var means the repo secret is not wired into the job.
export function requireInboxToken(): string {
  const token = process.env.E2E_INBOX_TOKEN;
  if (!token) {
    throw new Error(
      "E2E_INBOX_TOKEN is empty: the repo secret is not wired into the e2e-production job env in .github/workflows/ci.yml",
    );
  }
  return token;
}

function inboxHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  // The inbox hostname may sit inside the same Access application as 0509.io;
  // the service token headers are ignored anywhere it does not.
  const id = process.env.CF_ACCESS_CLIENT_ID;
  const secret = process.env.CF_ACCESS_CLIENT_SECRET;
  if (id && secret) {
    headers["CF-Access-Client-Id"] = id;
    headers["CF-Access-Client-Secret"] = secret;
  }
  return headers;
}

// Quoted-printable decoding, byte-accurate: soft breaks go first, then =XX
// pairs decode as bytes so multi-byte UTF-8 survives.
function decodeQuotedPrintable(input: string): string {
  const stripped = input.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < stripped.length; i++) {
    const pair = stripped.slice(i + 1, i + 3);
    if (stripped[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(pair)) {
      bytes.push(parseInt(pair, 16));
      i += 2;
    } else {
      bytes.push(stripped.charCodeAt(i) & 0xff);
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

// Enough MIME for a magic-link email: split multipart bodies on the boundary,
// decode each part's declared Content-Transfer-Encoding, and return the
// concatenated text. base64 parts that do not decode are kept raw.
function decodeMimeText(raw: string): string {
  const boundary = /boundary="?([^";\r\n]+)"?/.exec(raw)?.[1];
  const segments = boundary ? raw.split(`--${boundary}`) : [raw];
  const parts: string[] = [];
  for (const segment of segments) {
    const splitAt = segment.search(/\r?\n\r?\n/);
    const header = splitAt === -1 ? "" : segment.slice(0, splitAt);
    const body = splitAt === -1 ? segment : segment.slice(splitAt);
    const encoding = /content-transfer-encoding:\s*([0-9A-Za-z-]+)/i.exec(header)?.[1]?.toLowerCase();
    if (encoding === "base64") {
      try {
        parts.push(Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8"));
      } catch {
        parts.push(body);
      }
    } else if (encoding === "quoted-printable") {
      parts.push(decodeQuotedPrintable(body));
    } else {
      parts.push(body);
    }
  }
  return parts.join("\n");
}

function extractMagicLink(rawMessage: string): string | null {
  const text = decodeMimeText(rawMessage);
  const match = /https:\/\/0509\.io\/api\/auth\/magic-link\/verify\?[^\s"'<>]+/.exec(text);
  return match ? match[0] : null;
}

// Poll until the message lands or the deadline passes. 403 and 503 are
// immediate failures — the token gate answered, so the fault is the secret or
// its absence on the Worker, not a slow email.
async function waitForMagicLink(to: string, token: string): Promise<string> {
  const deadline = Date.now() + POLL_LIMIT_MS;
  let lastStatus = "the inbox endpoint did not respond";
  while (Date.now() < deadline) {
    const response = await fetch(`${INBOX_URL}/message?to=${encodeURIComponent(to)}`, {
      headers: inboxHeaders(token),
    });
    if (response.status === 200) {
      const link = extractMagicLink(await response.text());
      if (link) return link;
      lastStatus = "a message arrived but carried no magic-link verify URL";
    } else if (response.status === 404) {
      lastStatus = "inbox holds no message for this recipient";
    } else if (response.status === 403) {
      throw new Error(
        "0509-e2e-inbox rejected E2E_INBOX_TOKEN (HTTP 403): the repo secret and the Worker secret disagree",
      );
    } else if (response.status === 503) {
      throw new Error("0509-e2e-inbox reports E2E_INBOX_TOKEN is not set on the Worker");
    } else {
      lastStatus = `inbox endpoint answered HTTP ${response.status}`;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(
    `No magic-link email for ${to} within ${POLL_LIMIT_MS / 1000}s (${lastStatus}). ` +
      "If the inbox stayed at 404, the Email Routing rule e2e@0509.io -> 0509-e2e-inbox " +
      "is missing or the app's EMAIL binding did not deliver.",
  );
}

// J1's core: submit the login form for a fresh e2e+ address, read the real
// email out of the inbox Worker, follow the link, land signed in on /app.
// J2 reuses it — passkey registration needs the fresh session this produces.
// Timestamps are logged for the packet's proof line (send and session).
export async function signInWithMagicLink(page: Page, email: string, token: string): Promise<void> {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  const sentAt = new Date().toISOString();
  await page.locator('button[type="submit"]').click();
  // Sent state replaces the form; asserting the field is gone asserts the swap
  // without pinning copy (smoke.spec.ts's contract-not-copy convention).
  await expect(page.locator('input[name="email"]')).toHaveCount(0);
  const link = await waitForMagicLink(email, token);
  const linkReadAt = new Date().toISOString();
  await page.goto(link);
  await expect(page).toHaveURL(/\/app/);
  console.log(
    `magic-link sign-in email=${email} sentAt=${sentAt} linkReadAt=${linkReadAt} sessionAt=${new Date().toISOString()}`,
  );
}
