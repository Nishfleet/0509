import { Outlet, useRouteLoaderData } from "react-router";

import { ProductError } from "../components/error-page";
import type { Route } from "./+types/faces-layout";
import "../fonts-display.css";
import "../fonts-text.css";

export const links: Route.LinksFunction = () => [
  {
    rel: "preload",
    href: "/fonts/bricolage-grotesque-latin.woff2",
    as: "font",
    type: "font/woff2",
    crossOrigin: "anonymous",
  },
  {
    rel: "preload",
    href: "/fonts/instrument-sans-latin.woff2",
    as: "font",
    type: "font/woff2",
    crossOrigin: "anonymous",
  },
];

export default function FacesLayout() {
  return <Outlet />;
}

function rootSession(value: unknown): { signedIn: boolean; pathname: string } {
  if (typeof value !== "object" || value === null) return { signedIn: false, pathname: "this address" };
  const signedIn = "signedIn" in value && value.signedIn === true;
  const pathname = "pathname" in value && typeof value.pathname === "string" ? value.pathname : "this address";
  return { signedIn, pathname };
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const data = rootSession(useRouteLoaderData("root"));
  return <ProductError error={error} signedIn={data.signedIn} pathname={data.pathname} />;
}
