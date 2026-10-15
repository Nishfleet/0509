import { useNavigation } from "react-router";

export function usePendingOpen(entityId: string): boolean {
  const navigation = useNavigation();
  if (navigation.state === "idle") return false;
  return new URLSearchParams(navigation.location.search).get("open") === entityId;
}
