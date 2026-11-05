import { z } from "zod";
import { hairStyles, skinTones } from "./avatar";
import { imageMimeTypes, maxImageBytes, maxImages } from "./images";
import { rolePresetIds } from "./role-presets";

const id = z.string().min(1).max(100);
const text = z.string().trim().min(1).max(16000);
const point = z.object({
  x: z.number().int().min(1).max(28),
  y: z.number().int().min(1).max(16),
});
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const agentInput = z.object({
  id: id.optional(),
  name: z.string().trim().min(1).max(40),
  role: z.string().trim().min(1).max(80),
  instructions: text,
  promptPresetId: z.enum(rolePresetIds).optional(),
  model: z.string().max(100),
  reasoningEffort: z.string().max(100).optional(),
  avatar: z.number().int().min(0).max(3),
  hairColor: color,
  shirtColor: color,
  avatarParts: z.object({
    hairStyle: z.enum(hairStyles),
    skinTone: z.enum(skinTones),
    glasses: z.boolean(),
  }).strict().optional(),
  permission: z.enum(["read-only", "workspace-write"]),
  googleAccess: z.boolean(),
  serena: z.boolean().optional(),
  ponytail: z.boolean().optional(),
  boss: z.boolean().optional(),
  seat: point,
});
export const repositoryInput = z.object({
  id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/),
  name: z.string().trim().min(1).max(80),
  path: text,
  description: z.string().trim().max(16000).optional(),
}).strict();
export const projectInput = z.object({
  id: id.optional(),
  name: z.string().trim().min(1).max(80),
  path: text,
  description: z.string().trim().max(16000).optional(),
  repositories: z.array(repositoryInput).max(16).refine(
    (repos) => new Set(repos.map((r) => r.id)).size === repos.length,
    "ID repository ซ้ำ",
  ).optional(),
});
export const taskInput = z.object({
  title: z.string().trim().min(1).max(160),
  prompt: text,
  projectId: id,
  agentId: id,
  kind: z.enum(["general", "code"]).default("general"),
});
export const stageInput = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  kind: z.enum(["design", "work", "review", "summary"]),
  repositories: z.array(id).max(16),
  reviewRequired: z.boolean(),
  criteria: z.array(text).min(1).max(20),
}).strict();
export const templateStageInput = z.object({
  agentId: id, kind: z.enum(["general", "code"]), stageKind: z.enum(["design", "work", "review", "summary"]),
  reviewRequired: z.boolean(), dependsOn: z.array(z.number().int().nonnegative()).max(16),
  description: z.string().trim().min(1).max(1000), criteria: z.array(text).min(1).max(20),
}).strict();
export const templateInput = z.object({ id, projectId: id, sourceTaskId: id, name: z.string().trim().min(1).max(160), stages: z.array(templateStageInput).min(1).max(16) }).strict();
export const templateSaveInput = z.object({ projectId: id, taskId: id, name: z.string().trim().min(1).max(160), texts: z.array(z.object({ description: z.string().trim().min(1).max(1000), criteria: z.array(text).min(1).max(20) }).strict()).min(1).max(16) }).strict();
export const templateRefInput = z.object({ projectId: id, id }).strict();
export const templateRenameInput = templateRefInput.extend({ name: z.string().trim().min(1).max(160) }).strict();
export const templateCreateInput = z.object({ projectId: id, id, prompt: text }).strict();
export const templateDraftInput = z.object({ id, revision: z.number().int().positive(), assignments: z.array(z.object({ agentId: id, description: z.string().trim().min(1).max(1000), criteria: z.array(text).min(1).max(20), repositories: z.array(id).max(16) }).strict()).min(1).max(16) }).strict();
export const workflowResultInput = z.object({
  output: text,
  checks: z.array(z.object({ criterion: text, status: z.enum(["passed", "failed", "unverified"]), evidence: text }).strict()).min(1).max(20),
  incomplete: z.object({ reason: text, completed: text, remaining: text, needed: text, waitingForUser: z.boolean().optional(), verificationOnly: z.boolean().optional(), readyForReview: z.boolean().optional() }).strict().optional(),
}).strict();
export const workCheckDecisions = z.array(z.object({
  criterion: text, outcome: z.enum(["verified", "riskAccepted"]), evidence: text,
}).strict()).min(1).max(20);
export const workflowDecisionInput = z.object({
  id, revision: z.number().int().positive(),
  decision: z.enum(["approve", "reviewWork", "failWork", "revise", "accept", "replan", "close"]),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  checks: workCheckDecisions.optional(),
  body: z.string().trim().max(16000).optional(),
}).strict();
export const planInput = z.object({
  repositories: z.array(id).max(16).optional(),
  workflow: z.boolean().optional(),
  delegationReason: text.optional(),
  teamAvailability: z.array(z.object({ agentId: id, active: z.boolean(), queued: z.number().int().nonnegative() }).strict()).optional(),
  goal: text,
  steps: z.array(text).min(1).max(20),
  deliverable: text,
  assignments: z.array(taskInput.omit({ projectId: true }).extend({ stage: stageInput.optional(), deliverable: text, dependsOn: z.array(z.number().int().nonnegative()).max(16).optional() })).max(16),
}).strict().refine((plan) => plan.assignments.every((assignment, index) => (assignment.dependsOn || []).every((dependency) => dependency < index)), "งานย่อยอ้างอิงได้เฉพาะงานก่อนหน้าในแผน");
export const intakeResultInput = z.discriminatedUnion("intent", [
  z.object({ intent: z.enum(["reply", "clarify"]), reply: text }).strict(),
  z.object({ intent: z.literal("plan"), reply: text.optional(), title: taskInput.shape.title, kind: taskInput.shape.kind, plan: planInput }).strict(),
  z.object({ intent: z.literal("continue"), reply: text, instruction: text }).strict(),
]);
export const planDecisionInput = z.object({ id, revision: z.number().int().positive(), repositories: z.array(id).max(16).optional(), repositoryPaths: z.array(z.object({ id, path: text }).strict()).max(16).optional(), designs: z.array(z.object({ taskId: id, revision: z.number().int().positive(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), decision: z.enum(["reuse", "rerun"]) }).strict()).max(16).optional() }).strict();
export const intakeRetryInput = z.object({ id, retries: z.number().int().nonnegative() }).strict();
export const manualPlanInput = z.object({
  id,
  kind: taskInput.shape.kind,
  goal: text,
  steps: planInput.shape.steps,
  deliverable: text,
}).strict();
export const revisePlanInput = z.object({ id, body: text }).strict();
export const scheduleInput = taskInput.omit({ title: true }).extend({
  id: id.optional(),
  name: z.string().trim().min(1).max(100),
  frequency: z.enum(["once", "daily", "weekly"]),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weekday: z.number().int().min(0).max(6),
  timezone: z.string().refine((v) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }, "เขตเวลาไม่ถูกต้อง"),
  enabled: z.boolean(),
});
export const handoffReference = z.object({ kind: z.enum(["task", "conversation"]), id }).strict();

const chatRepositoryInput = z.object({ id, path: z.string().min(1).max(4096) }).strict();

export const messageInput = z
  .object({
    projectId: id,
    channel: id,
    to: id.optional(),
    taskId: id.optional(),
    taskSession: z.boolean().optional(),
    conversationId: id.optional(),
    handoff: handoffReference.optional(),
    handoffFiles: z.array(z.object({ path: z.string().min(1).max(4096), revision: z.number().int().positive().optional() }).strict()).max(2).optional(),
    mode: z.enum(["auto", "chat", "assign"]).optional(),
    editRepository: chatRepositoryInput.optional(),
    editRepositories: z.array(chatRepositoryInput).min(1).max(16).optional(),
    body: z.string().trim().max(16000).default(""),
    images: z
      .array(
        z
          .object({
            name: z
              .string()
              .trim()
              .min(1, "กรุณาระบุชื่อรูป")
              .max(200, "ชื่อรูปยาวเกิน 200 ตัวอักษร"),
            mime: z.enum(imageMimeTypes, {
              error: "รองรับเฉพาะ PNG, JPEG และ WebP",
            }),
            base64: z
              .string()
              .min(4, "ข้อมูลรูปไม่ครบ")
              .max(
                Math.ceil(maxImageBytes / 3) * 4,
                "ข้อมูลรูปมีขนาดเกิน 5 MiB",
              ),
          })
          .strict(),
      )
      .max(maxImages, "แนบรูปได้สูงสุด 4 รูป")
      .optional(),
  })
  .refine((v) => !v.editRepository || !v.editRepositories, "ระบุ repo ด้วยรูปแบบเดียว")
  .refine((v) => !v.editRepositories || new Set(v.editRepositories.map((repo) => repo.id)).size === v.editRepositories.length, "repo ซ้ำกัน")
  .refine(
    (v) => v.body.length > 0 || !!v.images?.length,
    "กรุณาพิมพ์ข้อความหรือแนบรูป",
  );
export const memoryInput = z.object({
  id: id.optional(),
  projectId: id,
  agentId: id.nullable(),
  text,
});
export const layoutInput = z
  .object({
    furniture: z
      .array(
        z.object({
          id,
          type: z.enum([
            "desk",
            "chair",
            "plant",
            "meeting",
            "sofa",
            "bookcase",
          ]),
          x: point.shape.x,
          y: point.shape.y,
        }),
      )
      .max(60),
  })
  .refine(
    ({ furniture }) =>
      new Set(furniture.map((f) => f.id)).size === furniture.length,
    "ID เฟอร์นิเจอร์ซ้ำ",
  );
export const decisionInput = z.object({
  id,
  approve: z.boolean(),
  answer: z.string().max(16000).optional(),
  answers: z.record(z.string(), z.string().max(16000)).optional(),
});
export const entityIdInput = z.object({ id });
export const resumeTaskInput = entityIdInput.extend({ body: z.string().trim().max(16000).optional(), checked: z.boolean().optional() });
export const taskReviewInput = entityIdInput.extend({ decision: z.enum(["accept", "close"]), version: z.string().regex(/^[a-f0-9]{64}$/) });
export const repositoryActionInput = entityIdInput.extend({ repositoryId: repositoryInput.shape.id.optional(), version: z.string().regex(/^[a-f0-9]{64}$/).optional() });
export const taskMergeInput = repositoryActionInput.extend({ recovery: z.boolean().optional() });
