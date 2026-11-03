"use client";
import { useState } from "react";
import type { Snapshot, Task } from "../shared/types";
import { projectRepositories } from "../shared/projects";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

export function TemplateDraftEditor({ task, state, action, changed }: {
  task: Task; state: Snapshot; action: (name: string, data?: unknown) => Promise<unknown>; changed: (dirty: boolean) => void;
}) {
  const [items, setItems] = useState(() => task.plan!.assignments.map((a) => ({ agentId: a.agentId, description: a.title, criteria: a.stage!.criteria.join("\n"), repositories: a.stage!.repositories })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const repositories = projectRepositories(state.projects.find((p) => p.id === task.projectId)!);
  const update = (index: number, patch: Partial<(typeof items)[number]>) => {
    setItems((old) => old.map((item, i) => i === index ? { ...item, ...patch } : item));
    changed(true);
  };
  return <form className="form" onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await action("template.editDraft", { id: task.id, revision: task.planRevision, assignments: items.map((item) => ({ ...item, criteria: item.criteria.split("\n").map((s) => s.trim()).filter(Boolean) })) });
      changed(false);
    } catch (e) { setError(e instanceof Error ? e.message : "บันทึกแผนไม่ได้"); }
    finally { setBusy(false); }
  }}>
    <h3>แก้แผนจากเทมเพลต</h3>
    {items.map((item, i) => {
      const assignment = task.plan!.assignments[i];
      const agent = state.agents.find((a) => a.id === item.agentId);
      const needsWrite = assignment.stage?.kind !== "summary" || assignment.kind === "code";
      const reason = !agent ? "ไม่พบสมาชิกเดิม กรุณาเลือกคนใหม่" : needsWrite && agent.permission !== "workspace-write" ? "สมาชิกไม่มีสิทธิ์เขียนไฟล์ กรุณาเลือกคนใหม่หรือปรับสิทธิ์" : "";
      return <fieldset key={i} className="space-y-2">
        <legend>ขั้น {i + 1} · {assignment.stage?.kind} · {assignment.stage?.reviewRequired ? "รออนุมัติ" : "ส่งต่อเมื่อผ่านเกณฑ์"}</legend>
        <label>ผู้รับผิดชอบขั้น {i + 1}
          <Select value={agent ? item.agentId : undefined} onValueChange={(agentId) => update(i, { agentId })}>
            <SelectTrigger aria-label={`ผู้รับผิดชอบขั้น ${i + 1}`}><SelectValue placeholder="เลือกสมาชิก" /></SelectTrigger>
            <SelectContent>{state.agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name} · {a.role}</SelectItem>)}</SelectContent>
          </Select>
        </label>
        {reason && <p role="alert" className="inline-error">{reason}</p>}
        <label>คำอธิบายขั้น<input required maxLength={1000} value={item.description} onChange={(e) => update(i, { description: e.target.value })} /></label>
        <label>เกณฑ์ตรวจรับ (หนึ่งข้อต่อบรรทัด)<textarea required maxLength={16000} rows={3} value={item.criteria} onChange={(e) => update(i, { criteria: e.target.value })} /></label>
        {assignment.kind === "code" && <fieldset><legend>Repository ที่ใช้ในขั้นนี้</legend>{!item.repositories.length && <p className="inline-error">เลือก repository ปัจจุบันก่อนยืนยันแผน</p>}{repositories.map((repo) => <label key={repo.id} className="flex gap-2"><input type="checkbox" checked={item.repositories.includes(repo.id)} onChange={(e) => update(i, { repositories: e.target.checked ? [...item.repositories, repo.id] : item.repositories.filter((id) => id !== repo.id) })} />{repo.name}</label>)}</fieldset>}
      </fieldset>;
    })}
    {error && <p role="alert" className="inline-error">{error}</p>}
    <button type="submit" disabled={busy}>บันทึกการแก้แผน</button>
  </form>;
}
