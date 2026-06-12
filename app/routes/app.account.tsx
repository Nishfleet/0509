import { useState } from "react";
import { useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { authClient } from "~/lib/auth-client";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "~/lib/support";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { createAuth, requireSession } = await import("~/lib/auth.server");
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  const session = await requireSession(env, request);

  const auth = createAuth(env, request);
  const sessions = await auth.api
    .listSessions({ headers: request.headers })
    .catch(() => [] as Array<{ id: string; createdAt: Date | string; userAgent?: string | null }>);

  return {
    email: session.user.email,
    name: session.user.name,
    currentSessionId: session.session.id,
    sessions: (sessions ?? []).map((entry) => ({
      id: entry.id,
      createdAt:
        entry.createdAt instanceof Date ? entry.createdAt.toISOString() : String(entry.createdAt),
      userAgent: entry.userAgent ?? null,
    })),
  };
}

export default function AccountRoute() {
  const data = useLoaderData<typeof loader>();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");

  async function run(label: string, work: () => Promise<{ error?: { message?: string } | null }>) {
    setPending(true);
    setMessage(null);
    try {
      const response = await work();
      if (response.error) {
        throw new Error(response.error.message || `${label} failed.`);
      }
      return true;
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : `${label} failed.` });
      return false;
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="f9-app-stack">
      {message ? (
        <div className={`f9-message ${message.ok ? "is-success" : "is-error"}`}>
          <p>{message.text}</p>
        </div>
      ) : null}

      <article className="f9-app-panel">
        <div className="f9-panel-toolbar">
          <div>
            <span className="f9-app-kicker">Account</span>
            <h2>Signed in as {data.email}</h2>
          </div>
        </div>

        <div className="f9-dashboard-grid">
          <form
            className="f9-auth-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const ok = await run("Password change", () =>
                authClient.changePassword({
                  currentPassword,
                  newPassword,
                  revokeOtherSessions: true,
                }),
              );
              if (ok) {
                setCurrentPassword("");
                setNewPassword("");
                setMessage({
                  ok: true,
                  text: "Password updated. Other devices have been signed out.",
                });
              }
            }}
          >
            <p className="f9-app-kicker">Change password</p>
            <label className="f9-field">
              <span>Current password</span>
              <input
                autoComplete="current-password"
                onChange={(event) => setCurrentPassword(event.currentTarget.value)}
                required
                type="password"
                value={currentPassword}
              />
            </label>
            <label className="f9-field">
              <span>New password</span>
              <input
                autoComplete="new-password"
                minLength={8}
                onChange={(event) => setNewPassword(event.currentTarget.value)}
                placeholder="At least 8 characters"
                required
                type="password"
                value={newPassword}
              />
            </label>
            <button className="f9-secondary-button" disabled={pending} type="submit">
              Update password
            </button>
          </form>

          <form
            className="f9-auth-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const ok = await run("Email change", () =>
                authClient.changeEmail({
                  newEmail: newEmail.trim(),
                  callbackURL: "/app/account",
                }),
              );
              if (ok) {
                setMessage({
                  ok: true,
                  text: `Confirmation sent to ${data.email}. The change applies once you confirm from that inbox.`,
                });
              }
            }}
          >
            <p className="f9-app-kicker">Change email</p>
            <label className="f9-field">
              <span>New email</span>
              <input
                autoComplete="email"
                onChange={(event) => setNewEmail(event.currentTarget.value)}
                placeholder="you@agency.com"
                required
                type="email"
                value={newEmail}
              />
            </label>
            <button className="f9-secondary-button" disabled={pending} type="submit">
              Send confirmation
            </button>
            <p className="f9-muted-copy">
              We confirm with your current address first — digests and alerts move with you.
            </p>
          </form>
        </div>
      </article>

      <article className="f9-app-panel">
        <div className="f9-panel-toolbar">
          <div>
            <span className="f9-app-kicker">Devices</span>
            <h2>Active sessions</h2>
          </div>
          <button
            className="f9-secondary-button"
            disabled={pending}
            onClick={async () => {
              const ok = await run("Sign out", () => authClient.revokeOtherSessions());
              if (ok) {
                setMessage({ ok: true, text: "Signed out everywhere else." });
              }
            }}
            type="button"
          >
            Sign out other devices
          </button>
        </div>
        <div className="f9-work-list is-compact">
          {data.sessions.map((entry) => (
            <div className="f9-work-row" key={entry.id}>
              <strong>
                {entry.id === data.currentSessionId ? "This device" : "Other device"}
              </strong>
              <span>
                {entry.userAgent ? `${entry.userAgent.slice(0, 60)} · ` : ""}
                since {formatDate(entry.createdAt)}
              </span>
            </div>
          ))}
        </div>
      </article>

      <article className="f9-app-panel">
        <div className="f9-panel-toolbar">
          <div>
            <span className="f9-app-kicker">Danger zone</span>
            <h2>Delete this account</h2>
          </div>
        </div>
        <p>
          Permanently removes your account, watchlists, history, and evidence. We email a
          confirmation link first; nothing is deleted until you click it. Deletion is blocked
          while a subscription is active — cancel first from{" "}
          <a href="/app/billing">Plan &amp; billing</a> (you keep access until the end of the
          period you've paid for), or email <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> and
          we'll handle both.
        </p>
        <button
          className="f9-secondary-button"
          disabled={pending}
          onClick={async () => {
            if (!confirm("Send the account-deletion confirmation email?")) {
              return;
            }
            const ok = await run("Account deletion", () =>
              authClient.deleteUser({ callbackURL: "/" }),
            );
            if (ok) {
              setMessage({
                ok: true,
                text: `Confirmation sent to ${data.email}. Your account stays intact until you confirm from that email.`,
              });
            }
          }}
          type="button"
        >
          Request account deletion
        </button>
      </article>
    </section>
  );
}

function formatDate(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return value;

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(time));
}
