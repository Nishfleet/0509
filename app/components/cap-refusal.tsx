import type { ReactElement } from "react";

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
          <a className="underline decoration-1 underline-offset-4" href="/pricing">
            See plans
          </a>
        </>
      ) : null}
    </p>
  );
}
