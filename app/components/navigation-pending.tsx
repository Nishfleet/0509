import { useEffect, useRef, useState, type ReactElement } from "react";
import { useLocation, useNavigation } from "react-router";

const TITLE_SUFFIX = " · Five to Nine";

function pageName(title: string): string {
  return title.endsWith(TITLE_SUFFIX) ? title.slice(0, -TITLE_SUFFIX.length) : title;
}

function useArrivalAnnouncement(): string {
  const { pathname } = useLocation();
  const previous = useRef(pathname);
  const [arrived, setArrived] = useState("");
  useEffect(() => {
    if (previous.current === pathname) return undefined;
    previous.current = pathname;
    const frame = requestAnimationFrame(() => {
      setArrived(pageName(document.title));
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [pathname]);
  return arrived;
}

export function NavigationPending(): ReactElement {
  const navigation = useNavigation();
  const arrived = useArrivalAnnouncement();
  const busy = navigation.state !== "idle";
  return (
    <div role="status" data-slot="navigation-pending">
      {busy ? (
        <>
          <span className="sr-only">Loading</span>
          <div aria-hidden="true" className="fixed inset-x-0 top-0 z-30 h-[3px] nav-pending bg-green" />
        </>
      ) : (
        <span className="sr-only">{arrived}</span>
      )}
    </div>
  );
}
