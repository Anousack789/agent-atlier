import { readFileSync } from "node:fs";
import type { RolePreset, RolePresetId } from "../shared/role-presets";

const catalog: { id: RolePresetId; label: string; role: string }[] = [
  { id: "frontend", label: "Frontend — นักพัฒนาหน้าบ้าน", role: "Frontend Developer" },
  { id: "backend", label: "Backend — นักพัฒนาหลังบ้าน", role: "Backend Developer" },
  { id: "tester", label: "Tester — นักทดสอบซอฟต์แวร์", role: "Tester" },
  { id: "ux-ui-designer", label: "UX/UI — นักออกแบบประสบการณ์", role: "UX/UI Designer" },
  { id: "marketing", label: "Marketing — นักการตลาด", role: "Marketing" },
  { id: "devops", label: "DevOps — ระบบและการส่งมอบ", role: "DevOps Engineer" },
  { id: "qa", label: "QA — ประกันคุณภาพ", role: "QA" },
  { id: "customer-support", label: "Customer Support — ดูแลลูกค้า", role: "Customer Support" },
  { id: "server-linux-security", label: "Security — ความปลอดภัย Server/Linux", role: "Server/Linux Security" },
  { id: "general-assistant", label: "General Assistant — ผู้ช่วยทั่วไป", role: "General Assistant" },
  { id: "planner", label: "Planner — นักวางแผน", role: "Planner" },
  { id: "full-stack-developer", label: "Full-stack — นักพัฒนาครบวงจร", role: "Full-stack Developer" },
  { id: "researcher", label: "Researcher — นักค้นคว้า", role: "Researcher" },
  { id: "content-writer", label: "Content Writer — นักเขียนเนื้อหา", role: "Content Writer" },
  { id: "data-analyst", label: "Data Analyst — นักวิเคราะห์ข้อมูล", role: "Data Analyst" },
];

export function loadRolePresets(root = new URL("../prompts/roles/", import.meta.url)): RolePreset[] {
  return catalog.map((preset) => {
    const file = `${preset.id}.md`;
    let instructions: string;
    try {
      instructions = readFileSync(new URL(file, root), "utf8").trim();
    } catch {
      throw new Error(`Cannot read role preset: ${file}`);
    }
    if (!instructions || instructions.length > 16000)
      throw new Error(`Role preset ${file} must contain 1–16000 characters`);
    for (const section of ["Role", "Responsibilities", "Working Process", "Quality Standards", "Boundaries", "Deliverables"])
      if (!instructions.split("\n").includes(`## ${section}`))
        throw new Error(`Role preset ${file} is missing section: ${section}`);
    return { ...preset, instructions };
  });
}

// Keep existing offices usable even if the installed prompt files are damaged.
let rolePresets: RolePreset[] = [];
let rolePresetsError = "";
try {
  rolePresets = loadRolePresets();
} catch (error) {
  rolePresetsError = error instanceof Error ? error.message : "Cannot load role presets";
  console.error(rolePresetsError);
}
export { rolePresets, rolePresetsError };
