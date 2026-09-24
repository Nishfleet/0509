import type { Route } from "./+types/terms";

import { LegalPage } from "../components/legal-page";
import { legalMeta } from "../lib/legal/meta";
import { TERMS } from "../lib/legal/terms";

export function meta(_: Route.MetaArgs) {
  return legalMeta(TERMS);
}

export default function Terms() {
  return <LegalPage doc={TERMS} />;
}
