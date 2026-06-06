import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { authClient } from "~/lib/auth-client";

interface AuthFormProps {
  mode: "login" | "signup";
  redirectTo: string;
}

export function AuthForm({ mode, redirectTo }: AuthFormProps) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignup = mode === "signup";
  const switchHref = isSignup
    ? `/auth/login?redirectTo=${encodeURIComponent(redirectTo)}`
    : `/auth/signup?redirectTo=${encodeURIComponent(redirectTo)}`;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      if (isSignup) {
        const response = await authClient.signUp.email({
          name: name.trim(),
          email: email.trim(),
          password,
          callbackURL: redirectTo,
        });

        if (response.error) {
          throw new Error(response.error.message);
        }
      } else {
        const response = await authClient.signIn.email({
          email: email.trim(),
          password,
          callbackURL: redirectTo,
        });

        if (response.error) {
          throw new Error(response.error.message);
        }
      }

      navigate(redirectTo, { replace: true });
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Authentication failed. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="f9-auth-card">
      <span>{isSignup ? "Create your watch desk" : "Welcome back"}</span>
      <h2>
        {isSignup
          ? "Start tracking competitor offer changes."
          : "Return to your competitor watch desk."}
      </h2>
      <p>
        {isSignup
          ? "Save competitor searches, launch watchlists, capture proof, and keep digests and share links reusable."
          : "Pick up your watchlists, proof captures, digests, and share links where you left them."}
      </p>

      <form className="f9-auth-form" onSubmit={handleSubmit}>
        {isSignup ? (
          <label className="f9-field">
            <span>Name</span>
            <input
              autoComplete="name"
              name="name"
              onChange={(event) => setName(event.currentTarget.value)}
              placeholder="Your name"
              required
              value={name}
            />
          </label>
        ) : null}

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

        <label className="f9-field">
          <span>Password</span>
          <input
            autoComplete={isSignup ? "new-password" : "current-password"}
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
          {pending
            ? "Working..."
            : isSignup
              ? "Create watch desk"
              : "Sign in"}
        </button>
      </form>

      <p className="f9-auth-switch">
        {isSignup ? "Already have an account?" : "Need an account?"}{" "}
        <Link to={switchHref}>
          {isSignup ? "Sign in" : "Create one"}
        </Link>
      </p>
    </div>
  );
}
