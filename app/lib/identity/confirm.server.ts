import { env } from "cloudflare:workers";

import { readHomeUrlForEntity } from "../data/page.server";
import { priorConfirmationExists, recordIdentityConfirmation } from "../data/user-decision.server";

export interface ConfirmIdentityArgs {
  workspaceId: string;
  userId: string;
  entityId: string;
  onboardingRunId: string;
  domain: string;
  publicSubject: "cleared" | "ask" | "unverified";
  edits: Record<string, string>;
}

export async function confirmIdentityCard(args: ConfirmIdentityArgs): Promise<void> {
  if (await priorConfirmationExists(args.workspaceId, args.entityId)) return;
  await env.IDENTITY_TAIL.createBatch([
    {
      id: `identity-${args.onboardingRunId}`,
      params: {
        workspaceId: args.workspaceId,
        userId: args.userId,
        entityId: args.entityId,
        onboardingRunId: args.onboardingRunId,
        domain: args.domain,
        homepageUrl: await readHomeUrlForEntity(args.entityId),
        publicSubject: args.publicSubject,
      },
    },
  ]);
  await recordIdentityConfirmation({
    workspaceId: args.workspaceId,
    userId: args.userId,
    entityId: args.entityId,
    runId: args.onboardingRunId,
    edits: args.edits,
  });
}
