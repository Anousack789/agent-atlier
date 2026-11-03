import type { MessageImage } from "./images";
import type { RolePresetId } from "./role-presets";
export type Point = { x: number; y: number };
export type AvatarParts = {
  hairStyle: "short" | "bob" | "long" | "curly";
  skinTone: "porcelain" | "light" | "medium" | "tan" | "brown" | "deep";
  glasses: boolean;
};
export type Agent = {
  id: string;
  name: string;
  role: string;
  instructions: string;
  promptPresetId?: RolePresetId;
  model: string;
  reasoningEffort?: string;
  avatar: number;
  hairColor: string;
  shirtColor: string;
  avatarParts?: AvatarParts;
  permission: "read-only" | "workspace-write";
  googleAccess: boolean;
  serena?: boolean;
  ponytail?: boolean;
  boss?: boolean;
  seat: Point;
};
export type Repository = { id: string; name: string; path: string; description?: string };
export type Project = {
  id: string;
  name: string;
  path: string;
  description?: string;
  repositories?: Repository[];
};
export type TaskWorktree = Repository & {
  workspace: string;
  branch: string;
  baseBranch: string;
  baseCommit: string;
  mergedAt?: string;
};
export type TaskStatus =
  | "pausing"
  | "paused"
  | "draft"
  | "queued"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";
export type Task = {
  reasoningEffort?: string;
  workflow?: import("./workflow").Workflow;
  stage?: import("./workflow").Stage;
  deliveries?: import("./workflow").Delivery[];
  reviewWorkspace?: string;
  workflowBlocked?: boolean;
  id: string;
  title: string;
  prompt: string;
  projectId: string;
  agentId: string;
  kind: "general" | "code";
  status: TaskStatus;
  output: string;
  error?: string;
  threadId?: string;
  turnId?: string;
  workspace?: string;
  branch?: string;
  baseBranch?: string;
  baseCommit?: string;
  mergedAt?: string;
  worktrees?: TaskWorktree[];
  scheduleId?: string;
  sourceMessageId?: string;
  plan?: TaskPlan;
  planReady?: boolean;
  bossPlan?: boolean;
  planRevision?: number;
  approvedRevision?: number;
  planningIntakeId?: string;
  parentTaskId?: string;
  dependsOn?: string[];
  relatedTaskId?: string;
  resumeNotes?: string[];
  followups?: string[];
  followupPending?: boolean;
  rootId: string;
  round: number;
  channel: string;
  activity: string;
  createdAt: string;
  updatedAt: string;
};
export type TaskPlan = {
  workflow?: boolean;
  goal: string;
  steps: string[];
  deliverable: string;
  assignments: { agentId: string; title: string; prompt: string; kind: "general" | "code"; deliverable: string; dependsOn?: number[]; stage?: import("./workflow").Stage }[];
};
export type Intake = Task & {
  intake: { boss: boolean; targetTaskId?: string; relatedTaskId?: string };
};
export type Message = {
  taskDeleted?: boolean;
  deliveryRevision?: number;
  id: string;
  projectId: string;
  channel: string;
  from: string;
  to?: string;
  body: string;
  images?: MessageImage[];
  taskId?: string;
  createdAt: string;
};
export type Memory = {
  id: string;
  projectId: string;
  agentId: string | null;
  text: string;
  updatedAt: string;
};
export type Schedule = {
  id: string;
  name: string;
  agentId: string;
  projectId: string;
  prompt: string;
  kind: "general" | "code";
  frequency: "once" | "daily" | "weekly";
  time: string;
  date: string;
  weekday: number;
  timezone: string;
  enabled: boolean;
  nextRun: string | null;
  lastRun?: string;
  planTaskId?: string;
  approvedPlan?: TaskPlan;
};
export type Approval = {
  taskDeleted?: boolean;
  id: string;
  type:
    | "delegate"
    | "command"
    | "file"
    | "external"
    | "conversation"
    | "input"
    | "git_init";
  status:
    | "pending"
    | "executing"
    | "approved"
    | "declined"
    | "failed"
    | "unknown"
    | "expired";
  title: string;
  details: string;
  projectId: string;
  agentId: string;
  taskId?: string;
  payload: Record<string, unknown>;
  rpcId?: number | string;
  createdAt: string;
  result?: string;
};
export type Furniture = {
  id: string;
  type: "desk" | "chair" | "plant" | "meeting" | "sofa" | "bookcase";
  x: number;
  y: number;
};
export type Layout = { id: "office"; furniture: Furniture[] };
export type Settings = {
  id: "settings";
  googleClientId: string;
  googleClientSecret: string;
  paused?: boolean;
};
export type Entities = {
  agents: Agent;
  projects: Project;
  tasks: Task;
  intakes: Intake;
  messages: Message;
  memories: Memory;
  schedules: Schedule;
  approvals: Approval;
  layout: Layout;
  settings: Settings;
};
export type Model = { model: string; displayName: string; isDefault?: boolean; supportedReasoningEfforts?: { reasoningEffort: string; description: string }[]; defaultReasoningEffort?: string };
export type Snapshot = {
  agents: Agent[];
  projects: Project[];
  tasks: Task[];
  intakes: Intake[];
  messages: Message[];
  memories: Memory[];
  schedules: Schedule[];
  approvals: Approval[];
  layout: Layout;
  models: Model[];
  codex: { state: "connecting" | "ready" | "error"; error?: string };
  google: {
    connected: boolean;
    email?: string;
    configured: boolean;
    clientId: string;
  };
  paused: boolean;
};
export const busyStatuses: TaskStatus[] = ["queued", "running", "waiting", "pausing"];
export const furnitureTypes: Furniture["type"][] = [
  "desk",
  "chair",
  "plant",
  "meeting",
  "sofa",
  "bookcase",
];
