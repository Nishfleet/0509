import type { Route } from "./+types/design.nav";
import { AppShell } from "../components/app-shell";

export function meta(_: Route.MetaArgs) {
  return [{ name: "robots", content: "noindex" }];
}

export default function Page() {
  return (
    <AppShell>
      <h1>Nav</h1>
    </AppShell>
  );
}
