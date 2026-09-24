import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { AuthorizationError } from "@cloudflare/workers-oauth-provider";
import { redirect } from "react-router";

import { readWorkspaceIdForOwner } from "../data/workspace.server";
import { READ_SCOPE } from "./paths";

export type ConsentView =
  | { kind: "error"; message: string }
  | { kind: "ask"; appName: string; returnsTo: string };

function withParams(target: string, params: Record<string, string | undefined>): string {
  const set = Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1]));
  const search = new URLSearchParams([...new URL(target).searchParams, ...set]);
  return `${target.split(/[?#]/)[0] ?? target}?${search.toString()}`;
}

function refusal(error: unknown): ConsentView | Response {
  if (!(error instanceof AuthorizationError)) throw error;
  if (!error.redirectUri) return { kind: "error", message: error.description };
  return redirect(
    withParams(error.redirectUri, {
      error: error.code,
      error_description: error.description,
      state: error.state,
      iss: error.issuer,
    }),
  );
}

async function parse(helpers: OAuthHelpers, request: Request): Promise<AuthRequest | ConsentView | Response> {
  try {
    return await helpers.parseAuthRequest(request);
  } catch (error) {
    return refusal(error);
  }
}

function hostOf(uri: string): string {
  const url = new URL(uri);
  return url.host === "" ? `${url.protocol}//` : url.host;
}

function appNameFor(clientName: string | undefined, redirectUri: string): string {
  const name = clientName?.trim() ?? "";
  return name === "" ? hostOf(redirectUri) : name;
}

export async function readConsent(helpers: OAuthHelpers, request: Request): Promise<ConsentView | Response> {
  const parsed = await parse(helpers, request);
  if (!("clientId" in parsed)) return parsed;
  const client = await helpers.lookupClient(parsed.clientId);
  return {
    kind: "ask",
    appName: appNameFor(client?.clientName, parsed.redirectUri),
    returnsTo: hostOf(parsed.redirectUri),
  };
}

export async function decideConsent(
  helpers: OAuthHelpers,
  request: Request,
  input: { userId: string; allow: boolean },
): Promise<ConsentView | Response> {
  const parsed = await parse(helpers, request);
  if (!("clientId" in parsed)) return parsed;
  const workspaceId = input.allow ? await readWorkspaceIdForOwner(input.userId) : null;
  if (workspaceId === null) {
    return redirect(
      withParams(parsed.redirectUri, {
        error: "access_denied",
        error_description: input.allow ? "Finish signing up at 0509.io first." : "The user said no.",
        state: parsed.state,
        iss: parsed.issuer,
      }),
    );
  }
  const client = await helpers.lookupClient(parsed.clientId);
  const { redirectTo } = await helpers.completeAuthorization({
    request: parsed,
    userId: input.userId,
    metadata: { appName: appNameFor(client?.clientName, parsed.redirectUri) },
    scope: [READ_SCOPE],
    props: { userId: input.userId, clientId: parsed.clientId },
  });
  return redirect(redirectTo);
}
