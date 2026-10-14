import type { ReactElement } from "react";
import { Link } from "react-router";

export function CapRefusal({
  result,
}: {
  result: { message?: string | null; upgradePlanId?: string | null } | undefined;
}): ReactElement | null {
  if (!result?.message) return null;
  return (
    <p data-slot="cap-refusal" role="alert" className="basis-full text-body-sm">
      {result.message}
      {result.upgradePlanId ? (
        <>
          {" "}
          <Link className="underline decoration-1 underline-offset-4" to="/pricing">
            See plans
          </Link>
        </>
      ) : null}
    </p>
  );
}
