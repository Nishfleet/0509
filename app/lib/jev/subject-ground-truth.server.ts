import type { Subject } from "../identity/normalise";

export type GroundRefusal = "private" | "minor" | "login";

export interface GroundTruth {
  refusal: GroundRefusal | null;
  fetched: boolean;
}

const MAX_BODY_BYTES = 2_500_000;

const LOGIN_HOSTS = new Set(["accounts.google.com"]);

const LOGIN_PATHS = new Set([
  "/login",
  "/signin",
  "/sign-in",
  "/accounts/login",
  "/i/flow/login",
]);

type ProfileRead =
  | { state: "refuse"; reason: "private" | "minor" }
  | { state: "readable" }
  | { state: "unknown" };

function agreed(values: readonly boolean[]): boolean | null {
  const first = values[0];
  if (first === undefined) return null;
  if (!values.every((value) => value === first)) return null;
  return first;
}

function agreedBoolean(body: string, pattern: RegExp): boolean | null {
  return agreed([...body.matchAll(pattern)].map((match) => match[1] === "true"));
}

function agreedProtected(body: string): boolean | null {
  return agreed(
    [...body.matchAll(/privacy:\$R\[\d+\]=\{protected:!(0|1)\}/g)].map((match) => match[1] === "0"),
  );
}

function booleanProfile(value: boolean | null): ProfileRead {
  if (value === true) return { state: "refuse", reason: "private" };
  if (value === false) return { state: "readable" };
  return { state: "unknown" };
}

function readProfile(platform: NonNullable<Subject["platform"]>, body: string): ProfileRead {
  if (platform === "instagram") return booleanProfile(agreedBoolean(body, /"is_private":(true|false)/g));
  if (platform === "youtube") return booleanProfile(agreedBoolean(body, /"unlisted":(true|false)/g));
  if (platform === "x") return booleanProfile(agreedProtected(body));
  const underThirteen = agreedBoolean(body, /"ftc":(true|false)/g);
  if (underThirteen === true) return { state: "refuse", reason: "minor" };
  const isPrivate = agreedBoolean(body, /"privateAccount":(true|false)/g);
  if (isPrivate === true) return { state: "refuse", reason: "private" };
  if (underThirteen === false || isPrivate === false) return { state: "readable" };
  return { state: "unknown" };
}

function isLoginUrl(finalUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(finalUrl);
  } catch (error) {
    console.log(
      JSON.stringify({
        event: "public_subject.ground_unread",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return false;
  }
  if (LOGIN_HOSTS.has(url.hostname)) return true;
  const path = url.pathname.length > 1 && url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  return LOGIN_PATHS.has(path);
}

export function groundRefusalFromDocument(input: {
  platform: NonNullable<Subject["platform"]>;
  status: number;
  finalUrl: string;
  body: string;
}): GroundRefusal | null {
  if (input.status === 401) return "login";
  const profile = readProfile(input.platform, input.body);
  if (profile.state === "refuse") return profile.reason;
  if (profile.state === "unknown" && isLoginUrl(input.finalUrl)) return "login";
  return null;
}

async function readBody(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (reader === undefined) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(next.value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

export async function readSubjectGroundTruth(subject: Subject): Promise<GroundTruth> {
  if (subject.platform === undefined || subject.url === null) return { refusal: null, fetched: false };
  const platform = subject.platform;
  const pageUrl = subject.url;
  let response: Response;
  try {
    response = await fetch(pageUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "FiveToNineBot/1.0 (+https://0509.io)",
      },
    });
  } catch (error) {
    console.log(
      JSON.stringify({
        event: "public_subject.ground_unread",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return { refusal: null, fetched: true };
  }
  if (response.status === 401) {
    await response.body?.cancel();
    return { refusal: "login", fetched: true };
  }
  const body = await readBody(response);
  if (body === null) return { refusal: null, fetched: true };
  return {
    refusal: groundRefusalFromDocument({
      platform,
      status: response.status,
      finalUrl: response.url,
      body,
    }),
    fetched: true,
  };
}
