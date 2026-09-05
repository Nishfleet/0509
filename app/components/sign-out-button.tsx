import { useState } from "react";

const localTestHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function SignOutButton() {
  const [pending, setPending] = useState(false);

  return (
    <form
      action="/auth/logout"
      method="post"
      onSubmit={(event) => {
        if (pending) {
          event.preventDefault();
          return;
        }

        event.preventDefault();
        setPending(true);
        fetch("/auth/logout", {
          body: new URLSearchParams(),
          credentials: "same-origin",
          method: "POST",
        })
          .catch(() => undefined)
          .finally(() => {
            if (localTestHosts.has(window.location.hostname)) {
              // The local E2E harness authenticates with a non-production fixture cookie.
              document.cookie = "f9_e2e_fixture=; Path=/; Max-Age=0; SameSite=Lax";
            }
            window.location.assign("/auth/login?redirectTo=%2Fapp");
          });
      }}
    >
      <button className="f9-wk-btn-quiet f9-sign-out-button" disabled={pending} type="submit">
        {pending ? "Signing out..." : "Sign out"}
      </button>
    </form>
  );
}
