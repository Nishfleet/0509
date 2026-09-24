import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { RouterContext } from "react-router";
import { createContext, RouterContextProvider } from "react-router";
import { z } from "zod";

const agentPropsSchema = z.object({
  userId: z.string().min(1),
  clientId: z.string().min(1),
});

export type AgentProps = z.output<typeof agentPropsSchema>;

export const oauthHelpersContext = createContext<OAuthHelpers>();
export const agentPropsContext = createContext<AgentProps>();

export function requestContext(helpers: OAuthHelpers | undefined, props?: unknown): RouterContextProvider {
  if (helpers === undefined) throw new Error("the OAuth provider did not hand its helpers to the request");
  const entries: [RouterContext, unknown][] = [[oauthHelpersContext, helpers]];
  const agent: [RouterContext, unknown][] =
    props === undefined ? [] : [[agentPropsContext, agentPropsSchema.parse(props)]];
  return new RouterContextProvider(new Map([...entries, ...agent]));
}
