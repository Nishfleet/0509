import type { Route } from "./+types/status";

import { StatusPage } from "../components/status-page";
import { currentStatus } from "../lib/observability/health.server";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Status · Five to Nine" },
    { name: "description", content: "Whether Five to Nine is up right now." },
  ];
}

export async function loader() {
  return { working: await currentStatus(), checkedAt: new Date().toISOString() };
}

export default function Status({ loaderData }: Route.ComponentProps) {
  return <StatusPage working={loaderData.working} checkedAt={loaderData.checkedAt} />;
}
