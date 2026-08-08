import { Form, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useEffect, useRef } from "react";

import { DashboardPage } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { ActionFeedback } from "~/components/action-feedback";
import { ConfirmSubmitButton } from "~/components/confirm-button";
import { LocalTime } from "~/components/local-time";
import { LockedFeature } from "~/components/locked-feature";
import { SubmitButton } from "~/components/submit-button";
import { WorkingHeader } from "~/components/workspace/working-header";

export const meta = () => [{ title: "Team | Five to Nine" }];

export function HydrateFallback() {
  return <DashboardRouteLoading title="Team" />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return <DashboardRouteError error={error} />;
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { getUserPlan } = await import("~/lib/plan.server");
  const { listWorkspaceMembers, resolveWorkspace, AGENCY_SEAT_LIMIT } = await import(
    "~/lib/workspace.server"
  );
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const workspace = await resolveWorkspace(env, session.user.id);

  if (workspace.isMember) {
    return {
      isMember: true as const,
      ownerName: workspace.ownerName,
      plan: null,
      seatLimit: AGENCY_SEAT_LIMIT,
      members: [],
    };
  }

  const [plan, members] = await Promise.all([
    getUserPlan(env, session.user.id),
    listWorkspaceMembers(env, session.user.id),
  ]);

  return {
    isMember: false as const,
    ownerName: null,
    plan,
    seatLimit: AGENCY_SEAT_LIMIT,
    members: members.map((member) => ({
      id: member.id,
      email: member.invitedEmail,
      status: member.status,
      createdAt: member.createdAt,
      acceptedAt: member.acceptedAt,
      tokenExpiresAt: member.tokenExpiresAt,
    })),
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { appOrigin } = await import("~/lib/env.server");
  const { createWorkspaceInvite, resendWorkspaceInvite, revokeWorkspaceMember } = await import("~/lib/workspace.server");
  const { sendTeamInviteEmail } = await import("~/lib/delivery.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "invite") {
    const email = String(formData.get("email") ?? "");
    const invite = await createWorkspaceInvite(env, {
      ownerUserId: session.user.id,
      ownerEmail: session.user.email,
      inviteeEmail: email,
    });

    if (!invite.ok) {
      return { ok: false, intent, message: invite.reason };
    }

    const origin = appOrigin(env, request);
    const sent = await sendTeamInviteEmail(env, {
      ownerUserId: session.user.id,
      ownerName: session.user.name ?? null,
      inviteeEmail: email,
      acceptUrl: `${origin}/team/accept?token=${invite.token}`,
    });

    return sent
      ? { ok: true, intent, message: `Invite sent to ${email.trim().toLowerCase()}. It expires in 7 days.` }
      : { ok: false, intent, message: "Invite saved, but the email failed to send — revoke and retry." };
  }

  if (intent === "revoke") {
    const memberId = String(formData.get("memberId") ?? "");
    const revoked = await revokeWorkspaceMember(env, {
      ownerUserId: session.user.id,
      memberRowId: memberId,
    });
    return revoked.ok
      ? { ok: true, intent, memberId, message: "Seat revoked. Their access ends immediately." }
      : { ok: false, intent, memberId, message: revoked.reason };
  }

  if (intent === "resend-invite") {
    const memberId = String(formData.get("memberId") ?? "");
    const invite = await resendWorkspaceInvite(env, {
      ownerUserId: session.user.id,
      memberRowId: memberId,
    });
    if (!invite.ok) {
      return { ok: false, intent, memberId, message: invite.reason };
    }

    const origin = appOrigin(env, request);
    const sent = await sendTeamInviteEmail(env, {
      ownerUserId: session.user.id,
      ownerName: session.user.name ?? null,
      inviteeEmail: invite.inviteeEmail,
      acceptUrl: `${origin}/team/accept?token=${invite.token}`,
    });

    return sent
      ? { ok: true, intent, memberId, message: `Invite resent to ${invite.inviteeEmail}. It expires in 7 days.` }
      : { ok: false, intent, memberId, message: "Invite refreshed, but the email failed to send — retry from this page." };
  }

  return { ok: false, message: "We couldn't complete that action. Refresh the page and try again." };
}

export default function TeamRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const revokeFeedbackRef = useRef<HTMLDivElement>(null);
  const revokedMemberStillPresent =
    actionData?.intent === "revoke" &&
    typeof actionData.memberId === "string" &&
    data.members.some((member) => member.id === actionData.memberId);
  const showRevocationCompletion = Boolean(
    actionData?.ok && actionData.intent === "revoke" && !revokedMemberStillPresent,
  );

  useEffect(() => {
    if (showRevocationCompletion) {
      revokeFeedbackRef.current?.focus();
    }
  }, [showRevocationCompletion, actionData?.memberId]);

  if (data.isMember) {
    return (
      <DashboardPage className="f9-wk-page f9-acct-page f9-acct-team">
        <WorkingHeader
          context="Watchlists, collections, and briefs are shared. Your sign-in stays your own."
          title="Team"
        />
        <section className="f9-acct-section" aria-labelledby="team-membership-title">
          <p className="f9-wk-kick">Your access</p>
          <h2 id="team-membership-title">
            A seat in {data.ownerName ? `${data.ownerName}'s` : "a shared"} workspace
          </h2>
          <p className="f9-acct-copy">
            The workspace owner manages seats and billing. You keep a separate sign-in and share
            the workspace&apos;s competitors, collections, and briefs.
          </p>
        </section>
      </DashboardPage>
    );
  }

  const seatsUsed = data.members.filter(
    (member) => member.status === "active" || !isInviteExpired(member.tokenExpiresAt),
  ).length + 1;

  return (
    <DashboardPage className="f9-wk-page f9-acct-page f9-acct-team">
      <WorkingHeader
        context={
          data.plan === "agency"
            ? `${seatsUsed} of ${data.seatLimit} Agency seats are in use.`
            : "Team access is included with Agency."
        }
        title="Team"
      />

      <div id="team-action-feedback" ref={revokeFeedbackRef} tabIndex={-1}>
        {showRevocationCompletion ? (
          <ActionFeedback data={actionData} />
        ) : (
          <ActionFeedback data={actionData} fallback />
        )}
      </div>

      {data.plan !== "agency" ? (
        <div className="f9-acct-lock">
          <LockedFeature
            eyebrow="Team"
            title="Invite your teammates"
            reason="Share watchlists, collections, and briefs with teammates — billing stays with you"
            planNeeded="Agency plan"
            upgradeTo="/app/billing?source=team#plans"
            headingLevel="h2"
          />
        </div>
      ) : (
      <section className="f9-acct-section" aria-labelledby="team-seats-title">
        <p className="f9-wk-kick">Workspace seats</p>
        <div className="f9-acct-section-head">
          <div>
            <h2 id="team-seats-title">{`${seatsUsed} of ${data.seatLimit} seats in use`}</h2>
            <p className="f9-acct-copy">
              Teammates share your watchlists, collections, and briefs. Billing stays with you.
            </p>
          </div>
        </div>

        <ActionFeedback data={actionData} intent="invite" />
        {seatsUsed < data.seatLimit ? (
          <Form method="post" className="f9-acct-invite">
            <input type="hidden" name="intent" value="invite" />
            <label className="f9-acct-field">
              <span>Teammate email</span>
              <input
                name="email"
                type="email"
                required
                placeholder="teammate@agency.com"
              />
            </label>
            <SubmitButton className="f9-wk-btn" intent="invite" pendingLabel="Sending…">
              Send invite
            </SubmitButton>
          </Form>
        ) : (
          <p className="f9-acct-note">
            All {data.seatLimit} seats are occupied. Revoke a seat before inviting someone else.
          </p>
        )}

        {data.members.length > 0 ? (
          <div className="f9-acct-member-list" aria-label="Workspace members">
            {data.members.map((member) => {
              const inviteExpired = member.status === "invited" && isInviteExpired(member.tokenExpiresAt);
              return (
                <div className="f9-acct-member-row" key={member.id}>
                  <div>
                    <strong className="f9-acct-entity">{member.email}</strong>
                    <p>
                      {member.status === "active" ? (
                        <>
                          Joined <LocalTime iso={member.acceptedAt ?? member.createdAt} />
                        </>
                      ) : inviteExpired ? (
                        <>
                          Invite expired{" "}
                          {member.tokenExpiresAt ? <LocalTime iso={member.tokenExpiresAt} /> : null}
                        </>
                      ) : (
                        <>
                          Invited <LocalTime iso={member.createdAt} /> — expires{" "}
                          {member.tokenExpiresAt ? <LocalTime iso={member.tokenExpiresAt} /> : "soon"}
                        </>
                      )}
                    </p>
                  </div>
                  <ActionFeedback
                    data={actionData}
                    intent="resend-invite"
                    match={{ memberId: member.id }}
                  />
                  <ActionFeedback
                    data={actionData}
                    intent="revoke"
                    match={{ memberId: member.id }}
                  />
                  <div className="f9-acct-row-actions">
                    {member.status === "invited" ? (
                      <Form method="post">
                        <input type="hidden" name="intent" value="resend-invite" />
                        <input type="hidden" name="memberId" value={member.id} />
                        <SubmitButton
                          className="f9-acct-text-action"
                          intent="resend-invite"
                          match={{ memberId: member.id }}
                          pendingLabel="Sending…"
                        >
                          Resend
                        </SubmitButton>
                      </Form>
                    ) : null}
                    <Form method="post">
                      <input type="hidden" name="intent" value="revoke" />
                      <input type="hidden" name="memberId" value={member.id} />
                      <ConfirmSubmitButton
                        className="f9-acct-text-action"
                        confirmLabel="Confirm — revoke seat?"
                        intent="revoke"
                        match={{ memberId: member.id }}
                        pendingLabel="Revoking…"
                      >
                        Revoke
                      </ConfirmSubmitButton>
                    </Form>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="f9-acct-empty">No teammates have been invited yet.</p>
        )}
      </section>
      )}
    </DashboardPage>
  );
}

function isInviteExpired(tokenExpiresAt: string | null) {
  if (!tokenExpiresAt) {
    return false;
  }
  return new Date(tokenExpiresAt).getTime() < Date.now();
}
