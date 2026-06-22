import { Form, Link, useNavigation } from "react-router";
import { useState } from "react";

interface AuthFormProps {
  mode: "login" | "signup";
  redirectTo: string;
  initialEmail?: string;
  message?: string | null;
  error?: string | null;
  oauthProviders?: AuthOAuthProvider[];
  passkeysEnabled?: boolean;
}

type AuthOAuthProvider = "google" | "microsoft";

const OAUTH_PROVIDER_LABELS: Record<AuthOAuthProvider, string> = {
  google: "Continue with Google",
  microsoft: "Continue with Microsoft",
};

export function AuthForm({
  mode,
  redirectTo,
  initialEmail,
  message,
  error,
  oauthProviders = [],
  passkeysEnabled = false,
}: AuthFormProps) {
  const navigation = useNavigation();
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [passkeyPending, setPasskeyPending] = useState(false);
  const isSignup = mode === "signup";
  const emailPending = navigation.state !== "idle";
  const pending = emailPending || passkeyPending;
  const availableOAuthProviders = oauthProviders.filter((provider) => provider in OAUTH_PROVIDER_LABELS);
  const showPasskeyLogin = !isSignup && passkeysEnabled;
  const showSecondaryAuth = availableOAuthProviders.length > 0 || showPasskeyLogin;
  const switchHref = isSignup
    ? `/auth/login?redirectTo=${encodeURIComponent(redirectTo)}`
    : `/auth/signup?redirectTo=${encodeURIComponent(redirectTo)}`;

  return (
    <div className="f9-auth-card">
      <span>{isSignup ? "Create your workspace" : "Welcome back"}</span>
      <h2>
        {isSignup
          ? "Verify your work email to start."
          : "Get a secure sign-in link."}
      </h2>
      <p>
        {isSignup
          ? "Five to Nine now uses organization-based sign-in. Your first verified login creates the workspace."
          : "Enter your work email and we'll send a one-time link to your inbox."}
      </p>

      <Form className="f9-auth-form" method="post">
        <input name="mode" type="hidden" value={mode} />
        <input name="redirectTo" type="hidden" value={redirectTo} />
        {isSignup ? (
          <>
            <label className="f9-field">
              <span>Name</span>
              <input autoComplete="name" name="name" placeholder="Your name" required />
            </label>
            <label className="f9-field">
              <span>Company or agency</span>
              <input
                autoComplete="organization"
                name="organizationName"
                placeholder="Your workspace name"
                required
              />
            </label>
          </>
        ) : null}

        <label className="f9-field">
          <span>Email</span>
          <input
            autoComplete={showPasskeyLogin ? "email webauthn" : "email"}
            defaultValue={initialEmail ?? ""}
            name="email"
            placeholder="you@company.com"
            required
            type="email"
          />
        </label>

        {message ? <p className="f9-message is-success">{message}</p> : null}
        {error ? <p className="f9-message is-error">{error}</p> : null}
        {passkeyError ? <p className="f9-message is-error">{passkeyError}</p> : null}

        <button className="f9-primary-button" disabled={pending} type="submit">
          {emailPending
            ? "Sending..."
            : isSignup
              ? "Send setup link"
              : "Send sign-in link"}
        </button>

        {showSecondaryAuth ? (
          <div className="f9-auth-oauth">
            <div className="f9-auth-divider">
              <span>Or continue with</span>
            </div>
            <div className="f9-auth-oauth-grid">
              {showPasskeyLogin ? (
                <button
                  className="f9-oauth-button is-passkey"
                  disabled={pending}
                  onClick={() => {
                    void startPasskeyLogin({
                      redirectTo,
                      setError: setPasskeyError,
                      setPending: setPasskeyPending,
                    });
                  }}
                  type="button"
                >
                  Continue with passkey
                </button>
              ) : null}
              {availableOAuthProviders.map((provider) => (
                <button
                  className={`f9-oauth-button is-${provider}`}
                  disabled={pending}
                  formAction="/auth/better/oauth"
                  formNoValidate
                  key={provider}
                  name="provider"
                  type="submit"
                  value={provider}
                >
                  {provider === "google" ? <GoogleIcon /> : null}
                  {OAUTH_PROVIDER_LABELS[provider]}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </Form>

      <p className="f9-auth-switch">
        {isSignup ? "Already have an account?" : "Need an account?"}{" "}
        <Link to={switchHref}>
          {isSignup ? "Sign in" : "Create one"}
        </Link>
      </p>
    </div>
  );
}

async function startPasskeyLogin(input: {
  redirectTo: string;
  setError: (message: string | null) => void;
  setPending: (pending: boolean) => void;
}) {
  input.setError(null);
  input.setPending(true);
  try {
    const { authClient } = await import("~/lib/auth-client");
    const result = await authClient.signIn.passkey();
    if (result.error) {
      throw new Error(result.error.message || "passkey_failed");
    }
    window.location.assign(input.redirectTo);
  } catch (error) {
    if (error instanceof Error && error.name === "NotAllowedError") {
      input.setError("Passkey sign-in was cancelled.");
    } else {
      input.setError("That passkey could not sign you in. Use the email link for now.");
    }
    input.setPending(false);
  }
}

function GoogleIcon() {
  return (
    <svg aria-hidden="true" className="f9-oauth-icon" viewBox="0 0 18 18">
      <path
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.87 2.69-6.62z"
        fill="#4285f4"
      />
      <path
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33C2.44 15.98 5.48 18 9 18z"
        fill="#34a853"
      />
      <path
        d="M3.96 10.71A5.41 5.41 0 0 1 3.68 9c0-.59.1-1.17.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.04l3-2.33z"
        fill="#fbbc05"
      />
      <path
        d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z"
        fill="#ea4335"
      />
    </svg>
  );
}
