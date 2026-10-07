import type { ReactElement } from "react";
import { useNavigation } from "react-router";

export function NavigationPending(): ReactElement {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  return (
    <div role="status" data-slot="navigation-pending">
      {busy ? (
        <>
          <span className="sr-only">Loading</span>
          <div aria-hidden="true" className="fixed inset-x-0 top-0 z-30 h-[3px] nav-pending bg-green" />
        </>
      ) : null}
    </div>
  );
}
