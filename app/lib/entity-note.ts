export const NOTE_MAX = 2000;

export const NOTE_TOO_LONG = `Keep it under ${String(NOTE_MAX)} characters.`;

export function noteRefusal(text: string): string | null {
  return text.length > NOTE_MAX ? NOTE_TOO_LONG : null;
}
