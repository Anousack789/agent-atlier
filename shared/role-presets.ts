export const rolePresetIds = [
  "frontend", "backend", "tester", "ux-ui-designer", "marketing", "devops",
  "qa", "customer-support", "server-linux-security", "general-assistant",
  "planner", "full-stack-developer", "researcher", "content-writer", "data-analyst",
] as const;

export type RolePresetId = (typeof rolePresetIds)[number];
export type RolePreset = {
  id: RolePresetId;
  label: string;
  role: string;
  instructions: string;
};
