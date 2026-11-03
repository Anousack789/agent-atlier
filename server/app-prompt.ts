import { readFileSync } from "node:fs";

export const appPrompt = readFileSync(new URL("../prompts/app.md", import.meta.url), "utf8").trim();
if (!appPrompt || appPrompt.length > 16000)
  throw new Error("prompts/app.md ต้องมีข้อความไม่เกิน 16,000 ตัวอักษร");

export const intakePrompt = readFileSync(new URL("../prompts/intake.md", import.meta.url), "utf8").trim();
export const bossPrompt = readFileSync(new URL("../prompts/boss.md", import.meta.url), "utf8").trim();
export const serenaPrompt = readFileSync(new URL("../prompts/serena.md", import.meta.url), "utf8").trim();
export const ponytailPrompt = readFileSync(new URL("../prompts/ponytail.md", import.meta.url), "utf8").trim();
