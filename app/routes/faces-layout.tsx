import { Outlet, unstable_useRoute } from "react-router";

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

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const data = unstable_useRoute("root")?.loaderData;
  return (
    <ProductError
      error={error}
      signedIn={data?.signedIn === true}
      pathname={data?.pathname ?? "this address"}
    />
  );
}
