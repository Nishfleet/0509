"use client";

import { useState } from "react";
import { useNavigate } from "react-router";

import { authClient } from "~/lib/auth-client";

export function SignOutButton() {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);

  return (
    <button
      className="button button-secondary"
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
