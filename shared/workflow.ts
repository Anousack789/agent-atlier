export type StageKind = "design" | "work" | "review" | "summary";
export type Stage = {
  key: string;
  kind: StageKind;
  repositories: string[];
  reviewRequired: boolean;
  criteria: string[];
};
export type Delivery = {
  revision: number;
  createdAt: string;
  output: string;
  fingerprint: string;
  approvedAt?: string;
  files: { path: string; name: string; digest: string }[];
  repositories: { id: string; fingerprint: string }[];
  prerequisites: { taskId: string; revision: number; fingerprint: string }[];
  checks: { criterion: string; status: "passed" | "failed" | "unverified"; evidence: string }[];
};
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
