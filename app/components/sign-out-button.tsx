import { useState } from "react";
import { useNavigate } from "react-router";

import { authClient } from "~/lib/auth-client";

export function SignOutButton() {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);

  return (
    <button
      className="f9-secondary-button f9-sign-out-button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await authClient.signOut();
        navigate("/", { replace: true });
      }}
      type="button"
    >
      {pending ? "Signing out..." : "Sign out"}
    </button>
  );
}
