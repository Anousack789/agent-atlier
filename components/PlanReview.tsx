"use client";
import { useState } from "react";
import type { Snapshot, Task } from "../shared/types";
import { busyStatuses } from "../shared/types";

export function PlanReview({ task, state, action }: {
  task: Task; state: Snapshot; action: (name: string, data?: unknown) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const intake = state.intakes.find((turn) => turn.id === task.planningIntakeId);
  const preparing = !!intake && busyStatuses.includes(intake.status);
  const schedule = state.schedules.find((s) => s.id === task.scheduleId);
  const run = async (name: string, data: unknown) => {
    setBusy(true);
    setError("");
    try { await action(name, data); setBody(""); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "ดำเนินการไม่ได้ กรุณาลองใหม่"); }
    finally { setBusy(false); }
  };
  return <section className="space-y-4" aria-label={`แผนงาน ${task.title}`}>
    <div>
      <h3>{task.title} · รอยืนยันแผน{task.planRevision ? ` v${task.planRevision}` : ""}</h3>
      <p className="muted" role="status">{preparing ? "กำลังตีความและเตรียมแผน ยังไม่เริ่มงาน" : task.planReady ? "ตรวจแผนก่อนยืนยัน งานยังไม่เข้าคิว" : "รอข้อมูลหรือแผนฉบับใหม่ก่อนยืนยัน งานยังไม่เข้าคิว"}</p>
      {task.plan?.workflow && <p className="note">อนุมัติแผนทีมครั้งเดียว · แบบต้องอนุมัติแยกก่อน dev เริ่ม · คุณตรวจรับก่อน merge · รวมโค้ดแยกแต่ละ repo</p>}
      <p className="muted">ผู้รับผิดชอบ: {state.agents.find((agent) => agent.id === task.agentId)?.name} · {task.kind === "code" ? "แก้โค้ดใน worktree แยก" : "งานทั่วไป"}</p>
    </div>
    {task.plan && <>
      <div><strong>เป้าหมาย</strong><p className="whitespace-pre-wrap break-words">{task.plan.goal}</p></div>
      <div><strong>ขั้นตอน</strong><ol className="list-decimal space-y-1 pl-6">{task.plan.steps.map((step, index) => <li className="whitespace-pre-wrap break-words" key={index}>{step}</li>)}</ol></div>
      <div><strong>ผลลัพธ์ที่จะส่งมอบ</strong><p className="whitespace-pre-wrap break-words">{task.plan.deliverable}</p></div>
      {!!task.plan.assignments.length && <div><strong>การกระจายงานที่ขออนุมัติ</strong><ul className="space-y-3 pt-2">{task.plan.assignments.map((assignment, index) => <li key={index}>
        <strong>{state.agents.find((a) => a.id === assignment.agentId)?.name} · {assignment.title}</strong>
        <p className="whitespace-pre-wrap break-words">{assignment.prompt}</p>
        <p className="muted break-words">{assignment.kind === "code" ? "แก้โค้ดใน worktree" : "งานทั่วไป"} · ผลลัพธ์: {assignment.deliverable}</p>
        {assignment.stage && <div className="flex flex-col gap-2"><p>{assignment.stage.kind} · {assignment.stage.reviewRequired ? "รอคุณอนุมัติผลงานก่อนส่งต่อ" : "ส่งต่อเมื่อผ่านเกณฑ์ครบ"}{assignment.stage.repositories.length ? ` · repo: ${assignment.stage.repositories.join(", ")}` : ""}</p><ul className="list-disc pl-5">{assignment.stage.criteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ul></div>}
        {!!assignment.dependsOn?.length && <p className="muted">รอผลจาก: {assignment.dependsOn.map((dependency) => task.plan!.assignments[dependency].title).join(", ")}</p>}
      </li>)}</ul></div>}
    </>}
    {schedule && <p className="note">อนุมัติให้ทำซ้ำ: {schedule.frequency === "once" ? `ครั้งเดียว ${schedule.date}` : schedule.frequency === "daily" ? "ทุกวัน" : `ทุกสัปดาห์ วัน${["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"][schedule.weekday]}`} เวลา {schedule.time} · {schedule.timezone} · การเขียน Google ยังขออนุมัติแต่ละครั้ง</p>}
    {intake?.error && <p className="inline-error">{intake.error}</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    <form className="form" onSubmit={(event) => { event.preventDefault(); void run("task.plan", { id: task.id, body: body.trim() || task.prompt }); }}>
      <label>ข้อมูลเพิ่มหรือสิ่งที่ต้องการแก้ในแผน<textarea value={body} maxLength={16000} rows={2} disabled={busy || preparing} onChange={(event) => setBody(event.target.value)} /></label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy || preparing}>{task.plan ? "ปรับแผน" : "เตรียมแผน"}</button>
        <button type="button" className="primary" disabled={busy || preparing || !task.plan || !task.planReady || !!body.trim()} onClick={() => void run("task.confirm", { id: task.id, revision: task.planRevision })}>
          {schedule ? "ยืนยันแผนและเปิดตาราง" : "ยืนยันและเริ่มงาน"}
        </button>
        <button type="button" disabled={busy} onClick={() => void run("task.stop", { id: task.id })}>ยกเลิกร่าง</button>
      </div>
    </form>
  </section>;
}
