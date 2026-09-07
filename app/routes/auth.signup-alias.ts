import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

export function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  throw redirect(`/auth/signup${url.search}`);
}
