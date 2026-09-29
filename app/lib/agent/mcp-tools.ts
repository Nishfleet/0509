export const registeredToolDescriptors = {
  get_standing: { title: "This week's standing" },
  get_brief: { title: "This week's brief" },
  list_competitors: { title: "Competitors" },
  get_competitor: { title: "One competitor" },
  list_alerts: { title: "Alerts" },
} as const satisfies Record<string, { title: string }>;

export type RegisteredToolName = keyof typeof registeredToolDescriptors;

export function namedTool<K extends RegisteredToolName>(name: K): { name: K; title: string } {
  return { name, title: registeredToolDescriptors[name].title };
}
