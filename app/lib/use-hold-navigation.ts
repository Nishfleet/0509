import { useEffect } from "react";
import { useBlocker } from "react-router";

export function useHoldNavigation(busy: boolean): void {
  const blocker = useBlocker(busy);
  useEffect(() => {
    if (blocker.state === "blocked" && !busy) blocker.proceed();
  }, [blocker, busy]);
}
