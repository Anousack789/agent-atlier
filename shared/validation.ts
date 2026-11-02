import { z } from "zod";
import { hairStyles, skinTones } from "./avatar";
import { imageMimeTypes, maxImageBytes, maxImages } from "./images";

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
  model: z.string().max(100),
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
  seat: point,
});
export const projectInput = z.object({
  id: id.optional(),
  name: z.string().trim().min(1).max(80),
  path: text,
});
export const taskInput = z.object({
  title: z.string().trim().min(1).max(160),
  prompt: text,
  projectId: id,
  agentId: id,
  kind: z.enum(["general", "code"]).default("general"),
});
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
export const messageInput = z
  .object({
    projectId: id,
    channel: id,
    to: id.optional(),
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
