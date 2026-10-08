type RowSwitchState = "on" | "off" | "you";

export interface RowSwitchView {
  state: RowSwitchState;
  pendingNote: string | null;
  errorNote: string | null;
}

interface RowSwitchInput {
  self: boolean;
  name: string;
  formData: FormData | undefined;
  message: string | null | undefined;
}

export function rowSwitchView({ self, name, formData, message }: RowSwitchInput): RowSwitchView {
  if (self) return { state: "you", pendingNote: null, errorNote: null };
  const intent = formData?.get("intent");
  if (intent === "off") return { state: "off", pendingNote: `Turning off ${name}…`, errorNote: null };
  if (intent === "on") return { state: "on", pendingNote: `Turning on ${name}…`, errorNote: null };
  return { state: "on", pendingNote: null, errorNote: message ?? null };
}
