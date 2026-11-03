import type { TaskPlan } from "./types";

export function delegationWarnings(plan: TaskPlan, bossId: string): string[] {
  if (!plan.teamAvailability || !plan.assignments.length) return [];
  const warnings: string[] = [];
  if (plan.assignments.every((assignment) => assignment.agentId === bossId)) warnings.push("Boss รับผิดชอบทุกขั้นตอน");
  if (plan.assignments.some((review) => review.stage?.kind === "review" && plan.assignments.some((work) => work.kind === "code" && work.agentId === review.agentId))) warnings.push("ผู้พัฒนาตรวจงานตัวเอง");
  return warnings;
}
