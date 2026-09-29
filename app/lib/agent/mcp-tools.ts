export const registeredToolDescriptors = {
  get_standing: { title: "This week's standing" },
  get_brief: { title: "This week's brief" },
  list_competitors: { title: "Competitors" },
  get_competitor: { title: "One competitor" },
  list_alerts: { title: "Alerts" },
} as const;

export type RegisteredToolName = keyof typeof registeredToolDescriptors;
