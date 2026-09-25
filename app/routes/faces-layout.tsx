import { Outlet } from "react-router";

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
