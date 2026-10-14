import type { ReactElement } from "react";

import { SupportLink } from "./footer";

const NOTE = "mt-10 border-t border-line pt-6 leading-[1.65] text-ink-soft";

export function AlertsFoot({ offLine }: { offLine: string | null }): ReactElement {
  return (
    <>
      {offLine === null ? null : (
        <p data-testid="alerts-off-footer" className={NOTE}>
          {offLine}
        </p>
      )}
      <p data-testid="alerts-help" className={offLine === null ? NOTE : "mt-4 leading-[1.65] text-ink-soft"}>
        Think an alert is wrong, or one is missing? Write to <SupportLink />. A person reads every message.
      </p>
    </>
  );
}
