import type { Route } from "./+types/signup";

import { redirect } from "react-router";

export function loader({ request }: Route.LoaderArgs) {
  return redirect(`/login${new URL(request.url).search}`);
}
