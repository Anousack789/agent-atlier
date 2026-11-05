import type { Task } from "./types";

export function canRecoverTaskCode(task: Task, parent?: Task) {
  return task.kind === "code" && (task.status === "failed" || task.status === "interrupted" ||
    (task.status === "completed" && !!task.stage && parent?.id === task.parentTaskId &&
      parent?.workflow?.phase === "interrupted" && parent.workflow.taskIds.includes(task.id)));
}

export type StageKind = "design" | "work" | "review" | "summary";
export const waitingForWorkInput = "ส่งงานยังไม่ครบ · รอคุณตรวจ";

export function blockedWorkDelivery(task: { stage?: Stage; deliveries?: Delivery[] }) {
  const delivery = task.deliveries?.at(-1);
  return task.stage?.kind === "work" && delivery?.incomplete && !delivery.humanReview && !delivery.humanRejection
    ? delivery : undefined;
}
export const readyWithLimitations = "พร้อมตรวจรับพร้อมข้อจำกัด";

export function outstandingWorkChecks(delivery: Delivery) {
  return delivery.checks.filter((check) => check.status === "unverified" ||
    (delivery.incomplete?.readyForReview === true && check.status === "failed"));
}

export const waitingForVerification = "รอตรวจเพิ่ม";
export const waitingForPrerequisite = "รอขั้นก่อนหน้า";
export const defectsFound = "พบข้อบกพร่อง";

export function pendingVerification(task: { stage?: Stage; deliveries?: Delivery[] }) {
  const delivery = task.deliveries?.at(-1);
  return (task.stage?.kind === "review" || task.stage?.kind === "summary") && delivery?.incomplete &&
    delivery.checks.some((check) => check.status === "unverified") &&
    delivery.checks.every((check) => check.status !== "failed") ? delivery : undefined;
}

export const legacyDesignApprovalCriterion = "แบบผ่านการอนุมัติจากผู้ใช้ก่อนเริ่ม implementation";
export const legacyDesignTaskId = "31e61d17-82d9-4941-b10f-8a4600687375";

export function isLegacyDesignApprovalCheck(taskId: string, delivery: Delivery, check: Delivery["checks"][number]) {
  return taskId === legacyDesignTaskId && delivery.revision === 1 &&
    check.criterion === legacyDesignApprovalCriterion && check.status === "unverified";
}
export type Stage = {
  key: string;
  kind: StageKind;
  repositories: string[];
  reviewRequired: boolean;
  criteria: string[];
};
export type WorkCheckDecision = { criterion: string; outcome: "verified" | "riskAccepted"; evidence: string };

export const incompleteDeliveryError = "สมาชิกส่งผลงานที่ยังไม่ครบ โปรดตรวจเหตุผลและปรับแผนแก้ไข";

export function reviewableWorkDelivery(task: import("./types").Task) {
  const delivery = task.deliveries?.at(-1);
  if (task.stage?.kind !== "work" ||
    (task.status !== "paused" && !(task.status === "failed" && task.error === incompleteDeliveryError)) ||
    task.workflowBlocked || task.mergedAt || task.worktrees?.some((tree) => tree.mergedAt) ||
    !delivery?.incomplete || delivery.humanReview || delivery.humanRejection || delivery.incomplete.waitingForUser !== false) return;
  if (delivery.incomplete.readyForReview === true && outstandingWorkChecks(delivery).length) return delivery;
  // KDS v7 predates verificationOnly. Its captured report lists only outstanding verification.
  const legacyKds = task.id === "859c4a7b-6165-43e5-96ad-c563b710b66f" && delivery.revision === 7 &&
    delivery.fingerprint === "62885baccce7171b99d57236b679098670affc629a7b94f62f4adc9ac37e80aa";
  if ((delivery.incomplete.verificationOnly === true || legacyKds) &&
    delivery.checks.some((check) => check.status === "unverified") &&
    delivery.checks.every((check) => check.status !== "failed")) return delivery;
}

export type Delivery = {
  revision: number;
  createdAt: string;
  output: string;
  fingerprint: string;
  summaryFingerprint?: string;
  approvedAt?: string;
  humanRejection?: { decidedBy: "user"; decidedAt: string; reason: string };
  humanReview?: { decidedAt: string; checks: WorkCheckDecision[] };
  files: { path: string; name: string; digest: string }[];
  repositories: { id: string; fingerprint: string }[];
  prerequisites: { taskId: string; revision: number; fingerprint: string }[];
  checks: { criterion: string; status: "passed" | "failed" | "unverified"; evidence: string }[];
  incomplete?: { reason: string; completed: string; remaining: string; needed: string; waitingForUser?: boolean; verificationOnly?: boolean; readyForReview?: boolean };
};

export function deliveryCheckLabel(task: Pick<Task, "id" | "stage">, delivery: Delivery, check: Delivery["checks"][number]) {
  if (isLegacyDesignApprovalCheck(task.id, delivery, check)) return delivery.approvedAt ? "ผู้ใช้อนุมัติแบบแล้ว" : "จุดอนุมัติแบบโดยผู้ใช้";
  if (check.status === "passed") return task.stage?.kind === "summary" ? "สรุปหลักฐานครบตามเกณฑ์" : "agent รายงานว่าผ่าน";
  return check.status === "failed" ? "agent รายงานว่าไม่ผ่าน" : "ยังไม่ได้ตรวจ";
}
export type Workflow = {
  repositories: import("./types").Repository[];
  phase: "active" | "acceptance" | "accepted" | "closed" | "replanning" | "interrupted";
  taskIds: string[];
  revision: number;
  acceptedFingerprint?: string;
  acceptedAt?: string;
  closedAt?: string;
  reason?: string;
};
