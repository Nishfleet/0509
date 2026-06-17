import { Form, Link, useNavigation } from "react-router";

interface AuthFormProps {
  mode: "login" | "signup";
  redirectTo: string;
  initialEmail?: string;
  message?: string | null;
  error?: string | null;
  oauthProviders?: AuthOAuthProvider[];
}

type AuthOAuthProvider = "google" | "microsoft";

const OAUTH_PROVIDER_LABELS: Record<AuthOAuthProvider, string> = {
  google: "Google",
  microsoft: "Microsoft",
};

export function AuthForm({ mode, redirectTo, initialEmail, message, error, oauthProviders = [] }: AuthFormProps) {
  const navigation = useNavigation();
  const isSignup = mode === "signup";
  const pending = navigation.state !== "idle";
  const availableOAuthProviders = oauthProviders.filter((provider) => provider in OAUTH_PROVIDER_LABELS);
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
            autoComplete="email"
            defaultValue={initialEmail ?? ""}
            name="email"
            placeholder="you@agency.com"
            required
            type="email"
          />
        </label>

        {message ? <p className="f9-message is-success">{message}</p> : null}
        {error ? <p className="f9-message is-error">{error}</p> : null}

        <button className="f9-primary-button" disabled={pending} type="submit">
          {pending
            ? "Sending..."
            : isSignup
              ? "Send setup link"
              : "Send sign-in link"}
        </button>

        {availableOAuthProviders.length > 0 ? (
          <div className="f9-auth-oauth">
            <div className="f9-auth-divider">
              <span>Or continue with</span>
            </div>
            <div className="f9-auth-oauth-grid">
              {availableOAuthProviders.map((provider) => (
                <button
                  className="f9-oauth-button"
                  disabled={pending}
                  formAction="/auth/stytch/oauth"
                  formNoValidate
                  key={provider}
                  name="provider"
                  type="submit"
                  value={provider}
                >
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
