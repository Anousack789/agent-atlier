"use client";
import { useState } from "react";
import type { Task } from "../shared/types";

export function TemplateSave({ task, action }: { task: Task; action: (name: string, data?: unknown) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  if (!task.plan?.workflow || !task.workflow?.acceptedAt || !["accepted", "closed"].includes(task.workflow.phase) || task.parentTaskId || task.rootId !== task.id) return null;
  return <section className="space-y-3">
    {!open ? <button type="button" onClick={() => { setOpen(true); setSaved(false); }}>บันทึกเป็นเทมเพลต</button> :
      <form className="form" onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const texts = task.plan!.assignments.map((_, i) => ({ description: String(form.get(`description-${i}`)), criteria: String(form.get(`criteria-${i}`)).split("\n").map((s) => s.trim()).filter(Boolean) }));
        setBusy(true); setError("");
        try { await action("template.save", { projectId: task.projectId, taskId: task.id, name: form.get("name"), texts }); setOpen(false); setSaved(true); }
        catch (e) { setError(e instanceof Error ? e.message : "บันทึกไม่ได้"); }
        finally { setBusy(false); }
      }}>
        <p className="note">กรอกข้อความสำหรับใช้ซ้ำใหม่ ห้ามใส่ข้อมูลเฉพาะงานหรือข้อมูลลับ แต่ละบรรทัดเป็นเกณฑ์หนึ่งข้อ</p>
        <label>ชื่อเทมเพลต<input name="name" required maxLength={160} /></label>
        {task.plan.assignments.map((assignment, i) => <fieldset key={i} className="space-y-2">
          <legend>ขั้น {i + 1} · {assignment.stage?.kind} · {assignment.stage?.reviewRequired ? "รออนุมัติ" : "ส่งต่อเมื่อผ่านเกณฑ์"}</legend>
          <label>คำอธิบายขั้นสำหรับใช้ซ้ำ<input name={`description-${i}`} required maxLength={1000} /></label>
          <label>เกณฑ์ตรวจรับสำหรับใช้ซ้ำ<textarea name={`criteria-${i}`} required rows={3} maxLength={16000} /></label>
        </fieldset>)}
        {error && <p role="alert" className="inline-error">{error}</p>}
        <div className="flex gap-2"><button className="primary" disabled={busy}>บันทึกเทมเพลต</button><button type="button" disabled={busy} onClick={() => setOpen(false)}>ยกเลิก</button></div>
      </form>}
    {saved && <p role="status">บันทึกเทมเพลตแล้ว</p>}
  </section>;
}
