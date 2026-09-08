import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const next = new URL("/auth/login", request.url);
  next.searchParams.set("error", "passwordless");
  throw redirect(`${next.pathname}${next.search}`);
}

export default function ForgotPasswordRoute() {
  return null;
}
