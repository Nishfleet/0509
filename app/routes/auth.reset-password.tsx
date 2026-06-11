import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { BrandWordmark } from "~/components/brand-wordmark";
import { authClient } from "~/lib/auth-client";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";

const description = "Choose a new password for your Five to Nine account.";

export const links: LinksFunction = () => canonicalLinks("/auth/reset-password");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Reset password | Five to Nine",
    description,
    pathname: "/auth/reset-password",
  });

export default function ResetPasswordRoute() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const invalidToken = searchParams.get("error") === "INVALID_TOKEN" || !token;
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setPending(true);
    setError(null);

    try {
      const response = await authClient.resetPassword({
        newPassword: password,
        token,
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      setDone(true);
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Could not reset the password. Please request a new link.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="f9-auth-page">
      <div className="f9-auth-gradient" aria-hidden="true" />
      <div className="f9-container f9-auth-layout">
        <section className="f9-auth-story">
          <Link className="f9-brand f9-auth-brand" to="/" aria-label="Five to Nine home">
            <BrandWordmark />
          </Link>

          <div>
            <span>Account recovery</span>
            <h1>Choose a new password.</h1>
            <p>Pick something at least 8 characters long that you don't use anywhere else.</p>
          </div>
        </section>

        <div className="f9-auth-card">
          <span>Reset your password</span>

          {done ? (
            <>
              <h2>Password updated.</h2>
              <p>Your new password is set. Sign in to get back to your workspace.</p>
              <Link className="f9-primary-button" to="/auth/login">
                Sign in
              </Link>
            </>
          ) : invalidToken ? (
            <>
              <h2>This reset link isn't valid anymore.</h2>
              <p>
                Reset links work once and expire after an hour. Request a fresh one and use it right
                away.
              </p>
              <Link className="f9-primary-button" to="/auth/forgot-password">
                Request a new link
              </Link>
            </>
          ) : (
            <>
              <h2>Set a new password.</h2>

              <form className="f9-auth-form" onSubmit={handleSubmit}>
                <label className="f9-field">
                  <span>New password</span>
                  <input
                    autoComplete="new-password"
                    minLength={8}
                    name="password"
                    onChange={(event) => setPassword(event.currentTarget.value)}
                    placeholder="At least 8 characters"
                    required
                    type="password"
                    value={password}
                  />
                </label>

                {error ? <p className="f9-message is-error">{error}</p> : null}

                <button className="f9-primary-button" disabled={pending} type="submit">
                  {pending ? "Saving..." : "Set new password"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
