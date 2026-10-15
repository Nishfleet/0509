import type { Route } from "./+types/status";

import { StatusPage } from "../components/status-page";
import { pageMeta } from "../lib/legal/meta";
import { currentStatus } from "../lib/observability/health.server";
import { STATUS_META } from "../lib/public-routes";

export function meta(_: Route.MetaArgs) {
  return pageMeta(STATUS_META);
}

export async function loader() {
  return { working: await currentStatus(), checkedAt: new Date().toISOString() };
}

export function headers() {
  return { "Cache-Control": "public, max-age=30" };
}

export default function Status({ loaderData }: Route.ComponentProps) {
  return <StatusPage working={loaderData.working} checkedAt={loaderData.checkedAt} />;
}
