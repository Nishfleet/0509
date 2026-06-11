import { useState } from "react";
import { Link } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";

import { BrandWordmark } from "~/components/brand-wordmark";
import { authClient } from "~/lib/auth-client";
import { canonicalLinks, publicSeoMeta } from "~/lib/seo";

const description = "Request a password reset link for your Five to Nine account.";

export const links: LinksFunction = () => canonicalLinks("/auth/forgot-password");

export const meta: MetaFunction = () =>
  publicSeoMeta({
    title: "Forgot password | Five to Nine",
    description,
    pathname: "/auth/forgot-password",
  });

export default function ForgotPasswordRoute() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const response = await authClient.requestPasswordReset({
        email: email.trim(),
        redirectTo: "/auth/reset-password",
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      setSent(true);
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Could not send the reset email. Please try again.",
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
            <h1>Get back into your workspace.</h1>
            <p>
              Enter your account email and we'll send a one-hour reset link. Your watchlists,
              digests, and plan stay exactly as you left them.
            </p>
          </div>
        </section>

        <div className="f9-auth-card">
          <span>Reset your password</span>
          <h2>{sent ? "Check your email." : "Forgot your password?"}</h2>

          {sent ? (
            <p>
              If an account exists for {email.trim()}, a reset link is on its way. The link works
              for one hour — check spam if it doesn't arrive in a couple of minutes.
            </p>
          ) : (
            <>
              <p>Enter the email you signed up with and we'll send a reset link.</p>

              <form className="f9-auth-form" onSubmit={handleSubmit}>
                <label className="f9-field">
                  <span>Email</span>
                  <input
                    autoComplete="email"
                    name="email"
                    onChange={(event) => setEmail(event.currentTarget.value)}
                    placeholder="you@agency.com"
                    required
                    type="email"
                    value={email}
                  />
                </label>

                {error ? <p className="f9-message is-error">{error}</p> : null}

                <button className="f9-primary-button" disabled={pending} type="submit">
                  {pending ? "Sending..." : "Send reset link"}
                </button>
              </form>
            </>
          )}

          <p className="f9-auth-switch">
            Remembered it? <Link to="/auth/login">Sign in</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
