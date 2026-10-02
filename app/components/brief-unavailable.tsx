import { SupportLink } from "./footer";

export function BriefUnavailable() {
  return (
    <p className="leading-[1.65]">
      This brief could not be shown here. Your other weeks are listed below, and the email we sent has the same brief.
      If it keeps happening, write to <SupportLink />.
    </p>
  );
}
