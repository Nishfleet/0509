import { Form, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import { DashboardRouteError, DashboardRouteLoading } from "~/components/dashboard-route-loading";
import { ActionFeedback } from "~/components/action-feedback";
import { ConfirmSubmitButton } from "~/components/confirm-button";
import { LocalTime } from "~/components/local-time";
import { SubmitButton } from "~/components/submit-button";

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

  const plan = await getUserPlan(env, session.user.id);
  const members = await listWorkspaceMembers(env, session.user.id);

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
    await revokeWorkspaceMember(env, {
      ownerUserId: session.user.id,
      memberRowId: memberId,
    });
    return { ok: true, intent, memberId, message: "Seat revoked. Their access ends immediately." };
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

  return { ok: false, message: "Unknown action." };
}

export default function TeamRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  if (data.isMember) {
    return (
      <DashboardPage>
        <section className="f9-app-stack">
          <DashboardPageHeader
            lead="Watchlists, collections, and digests here are shared with the whole team. Your sign-in stays your own."
            title="Team"
          />

        <article className="f9-app-panel">
          <div className="f9-panel-toolbar">
            <div>
              <h2>Your seat in {data.ownerName ? `${data.ownerName}'s` : "a shared"} account</h2>
            </div>
          </div>
        </article>
        </section>
      </DashboardPage>
    );
  }

  const seatsUsed = data.members.length + 1;

  return (
    <DashboardPage>
      <section className="f9-app-stack">
        <DashboardPageHeader
          lead="Invite teammates to share watchlists, collections, and digests on Agency."
          title="Team"
        />

      <ActionFeedback data={actionData} fallback />

      <article className="f9-app-panel">
        <div className="f9-panel-toolbar">
          <div>
            <h2>
              {data.plan === "agency"
                ? `${seatsUsed} of ${data.seatLimit} Agency seats in use`
                : "Team seats come with Agency"}
            </h2>
          </div>
        </div>

        <p>
          {data.plan === "agency"
            ? "Teammates you invite share your watchlists, collections, and digests — billing stays with you."
            : "Upgrade to the Agency plan to share your account with teammates."}
        </p>

        <ActionFeedback data={actionData} intent="invite" />
        {data.plan === "agency" && seatsUsed < data.seatLimit ? (
          <Form method="post" className="f9-action-row">
            <input type="hidden" name="intent" value="invite" />
            <input
              aria-label="Teammate email"
              name="email"
              type="email"
              required
              placeholder="teammate@agency.com"
            />
            <SubmitButton className="f9-primary-button" intent="invite" pendingLabel="Sending…">
              Send invite
            </SubmitButton>
          </Form>
        ) : null}

        <ActionFeedback data={actionData} intent="revoke" />
        {data.members.length > 0 ? (
          <div className="f9-work-list is-compact">
            {data.members.map((member) => {
              const inviteExpired = member.status === "invited" && isInviteExpired(member.tokenExpiresAt);
              return (
                <div className="f9-work-row" key={member.id}>
                  <div>
                    <strong>{member.email}</strong>
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
                  <div className="f9-action-row">
                    {member.status === "invited" ? (
                      <Form method="post">
                        <input type="hidden" name="intent" value="resend-invite" />
                        <input type="hidden" name="memberId" value={member.id} />
                        <SubmitButton
                          className="f9-secondary-button"
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
                        className="f9-secondary-button"
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
        ) : null}
      </article>
      </section>
    </DashboardPage>
  );
}

function isInviteExpired(tokenExpiresAt: string | null) {
  if (!tokenExpiresAt) {
    return false;
  }
  return new Date(tokenExpiresAt).getTime() < Date.now();
}
