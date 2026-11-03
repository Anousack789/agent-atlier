import type { OfficeRuntime } from "../server/runtime";
import { taskInput } from "../shared/validation";

// Execution tests start from an already approved fixture; intake/confirmation have their own tests.
export function createApprovedTask(runtime: OfficeRuntime, input: unknown, extra: Parameters<OfficeRuntime["createTask"]>[1] = {}) {
  const data = taskInput.parse(input);
  return runtime.createTask(data, { ...extra, authorized: true,
    plan: { goal: data.prompt, steps: [data.prompt], deliverable: "ผลลัพธ์สำหรับทดสอบ", assignments: [] },
  });
}
