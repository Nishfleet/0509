import type { Route } from "./+types/security";

import { LegalPage } from "../components/legal-page";
import { legalMeta } from "../lib/legal/meta";
import { SECURITY } from "../lib/legal/security";

export function meta(_: Route.MetaArgs) {
  return legalMeta(SECURITY);
}

export default function Security() {
  return <LegalPage doc={SECURITY} />;
}
