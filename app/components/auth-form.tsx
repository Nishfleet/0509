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
    <div className="auth-card">
      <p className="eyebrow">{isSignup ? "Create your workspace" : "Welcome back"}</p>
      <h1>{isSignup ? "Start tracking competitor shifts." : "Sign in to Five to Nine."}</h1>
      <p className="auth-copy">
        {isSignup
          ? "Saved searches, watchlists, and weekly digests all live behind your account."
          : "Pick up your saved research, watchlists, and share links where you left them."}
      </p>

      <form className="stack-form" onSubmit={handleSubmit}>
        {isSignup ? (
          <label className="field">
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

        <label className="field">
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

        <label className="field">
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

        {error ? <p className="form-message form-message-error">{error}</p> : null}

        <button className="button button-primary" disabled={pending} type="submit">
          {pending
            ? "Working..."
            : isSignup
              ? "Create account"
              : "Sign in"}
        </button>
      </form>

      <p className="auth-switch">
        {isSignup ? "Already have an account?" : "Need an account?"}{" "}
        <Link to={isSignup ? `/auth/login?redirectTo=${encodeURIComponent(redirectTo)}` : `/auth/signup?redirectTo=${encodeURIComponent(redirectTo)}`}>
          {isSignup ? "Sign in" : "Create one"}
        </Link>
      </p>
    </div>
  );
}
