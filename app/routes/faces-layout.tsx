import { Outlet } from "react-router";
import type { LinksFunction } from "react-router";

import "../fonts.css";

export const links: LinksFunction = () => [
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
