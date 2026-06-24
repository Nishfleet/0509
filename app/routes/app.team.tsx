import { Form, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { LocalTime } from "~/components/local-time";
import { SubmitButton } from "~/components/submit-button";

export const meta = () => [{ title: "Team | Five to Nine" }];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { getUserPlan } = await import("~/lib/plan.server");
  const { requireWorkspacePlanFeature } = await import("~/lib/plan-feature-gate.server");
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

  const teamGate = await requireWorkspacePlanFeature(env, session.user.id, "team_workspace");
  if (!teamGate.ok) {
    throw teamGate.response;
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
    })),
  };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const { appOrigin } = await import("~/lib/env.server");
  const { createWorkspaceInvite, revokeWorkspaceMember } = await import("~/lib/workspace.server");
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
      return { ok: false, message: invite.reason };
    }

    const origin = appOrigin(env, request);
    const sent = await sendTeamInviteEmail(env, {
      ownerUserId: session.user.id,
      ownerName: session.user.name ?? null,
      inviteeEmail: email,
      acceptUrl: `${origin}/team/accept?token=${invite.token}`,
    });

    return sent
      ? { ok: true, message: `Invite sent to ${email.trim().toLowerCase()}. It expires in 7 days.` }
      : { ok: false, message: "Invite saved, but the email failed to send — revoke and retry." };
  }

  if (intent === "revoke") {
    await revokeWorkspaceMember(env, {
      ownerUserId: session.user.id,
      memberRowId: String(formData.get("memberId") ?? ""),
    });
    return { ok: true, message: "Seat revoked. Their access ends immediately." };
  }

  return { ok: false, message: "Unknown action." };
}

export default function TeamRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  if (data.isMember) {
    return (
      <section className="f9-app-stack">
        <article className="f9-app-panel">
          <div className="f9-panel-toolbar">
            <div>
              <span className="f9-app-kicker">Team</span>
              <h2>Your seat in {data.ownerName ? `${data.ownerName}'s` : "a shared"} account</h2>
            </div>
          </div>
          <p>
            Watchlists, boards, and morning briefs here are shared with the whole team. Your
            sign-in, password, and sessions stay your own.
          </p>
        </article>
      </section>
    );
  }

  const seatsUsed = data.members.length + 1;

  return (
    <section className="f9-app-stack">
      {actionData?.message ? (
        <div className={`f9-message ${actionData.ok ? "is-success" : "is-error"}`}>
          <p>{actionData.message}</p>
        </div>
      ) : null}

      <article className="f9-app-panel">
        <div className="f9-panel-toolbar">
          <div>
            <span className="f9-app-kicker">Team</span>
            <h2>
              {data.plan === "agency"
                ? `${seatsUsed} of ${data.seatLimit} Agency seats in use`
                : "Team seats come with Agency"}
            </h2>
          </div>
        </div>

        <p>
          {data.plan === "agency"
            ? "Teammates you invite share your watchlists, boards, and briefs — billing stays with you."
            : "Upgrade to the Agency plan to share your account with teammates."}
        </p>

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
            <SubmitButton pendingLabel="Sending…">Send invite</SubmitButton>
          </Form>
        ) : null}

        {data.members.length > 0 ? (
          <div className="f9-work-list is-compact">
            {data.members.map((member) => (
              <div className="f9-work-row" key={member.id}>
                <div>
                  <strong>{member.email}</strong>
                  <p>
                    {member.status === "active" ? (
                      <>
                        Joined <LocalTime iso={member.acceptedAt ?? member.createdAt} />
                      </>
                    ) : (
                      <>
                        Invited <LocalTime iso={member.createdAt} /> — pending
                      </>
                    )}
                  </p>
                </div>
                <Form method="post">
                  <input type="hidden" name="intent" value="revoke" />
                  <input type="hidden" name="memberId" value={member.id} />
                  <SubmitButton pendingLabel="Revoking…">Revoke</SubmitButton>
                </Form>
              </div>
            ))}
          </div>
        ) : null}
      </article>
    </section>
  );
}
