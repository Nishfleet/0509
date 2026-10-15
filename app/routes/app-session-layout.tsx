import type { Route } from "./+types/app-session-layout";
import { Outlet } from "react-router";

import { requireSessionMiddleware } from "../lib/require-session.server";

export const middleware: Route.MiddlewareFunction[] = [requireSessionMiddleware];

export default function AppSessionLayout() {
  return <Outlet />;
}
