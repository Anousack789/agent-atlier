"use client";
import { useState } from "react";
import type { Snapshot, Task } from "../shared/types";
import { busyStatuses } from "../shared/types";
import { TemplateDraftEditor } from "./TemplateDraftEditor";
import { delegationWarnings } from "../shared/delegation";

export function PlanReview({ task, state, action }: {
  task: Task; state: Snapshot; action: (name: string, data?: unknown) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [designChoices, setDesignChoices] = useState<Record<string, "reuse" | "rerun">>({});
  const intake = state.intakes.find((turn) => turn.id === task.planningIntakeId);
  const preparing = !!intake && busyStatuses.includes(intake.status);
  const schedule = state.schedules.find((s) => s.id === task.scheduleId);
  const warnings = task.plan ? delegationWarnings(task.plan, task.agentId) : [];
  const previous = task.workflow?.taskIds.flatMap((id) => state.tasks.find((item) => item.id === id) || []) || [];
  const approvedDesigns = previous.filter((item) => item.stage?.kind === "design" && item.deliveries?.at(-1)?.approvedAt);
  const missingDesigns = approvedDesigns.filter((item) => !task.plan?.assignments.some((assignment) => assignment.stage?.key === item.stage?.key && assignment.stage?.kind === "design"));
  const choicesReady = approvedDesigns.every((item) => !!designChoices[item.id]);
  const projected: { id?: string; ready: boolean; label: string }[] = [];
  for (const assignment of task.plan?.assignments || []) {
    const existing = previous.find((item) => item.stage?.key === assignment.stage?.key);
    const delivery = existing?.deliveries?.at(-1);
    const choice = existing && designChoices[existing.id];
    const isApprovedDesign = existing?.stage?.kind === "design" && !!delivery?.approvedAt;
    const dependencies = (assignment.dependsOn || []).map((index) => projected[index]);
    const changed = existing && (existing.prompt !== assignment.prompt || existing.agentId !== assignment.agentId || JSON.stringify(existing.stage) !== JSON.stringify(assignment.stage) || JSON.stringify(existing.dependsOn || []) !== JSON.stringify(dependencies.map((item) => item?.id)));
    const rerun = !existing || !!changed || existing.workflowBlocked || ["failed", "cancelled", "interrupted", "queued", "running"].includes(existing.status) || dependencies.some((item) => !item?.ready);
    const ready = isApprovedDesign ? choice === "reuse" : !rerun && existing?.status === "completed" && !!delivery && (!existing.stage?.reviewRequired || !!delivery.approvedAt);
    projected.push({ id: existing?.id, ready, label: isApprovedDesign ? choice === "reuse" ? "ใช้แบบที่อนุมัติแล้ว" : choice === "rerun" ? "ทำแบบใหม่และรออนุมัติ" : "รอเลือกว่าจะใช้แบบเดิมหรือทำใหม่" : ready ? "ใช้ผลงานเดิม" : "ทำขั้นนี้ตามลำดับและเงื่อนไขที่ระบุ" });
  }
  const unavailable = task.templateDraft && task.plan?.assignments.some((assignment) => {
    const agent = state.agents.find((a) => a.id === assignment.agentId);
    return !agent || ((assignment.stage?.kind !== "summary" || assignment.kind === "code") && agent.permission !== "workspace-write");
  });
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
      {!!warnings.length && <div className="note" role="note"><strong>ตรวจการกระจายงาน</strong><ul className="list-disc pl-5">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul><p className="whitespace-pre-wrap break-words">เหตุผลจาก Boss: {task.plan.delegationReason || "ไม่ได้ระบุ — สามารถขอให้ปรับแผนและอธิบายก่อนยืนยัน"}</p><p>คำเตือนช่วยตรวจแผน ไม่ได้หมายความว่าการเลือกนี้ผิด</p></div>}
      {!!task.plan.teamAvailability?.length && <div><strong>สถานะสมาชิก ณ เวลาสร้างแผน</strong><ul>{task.plan.teamAvailability.map((entry) => <li key={entry.agentId}>{state.agents.find((agent) => agent.id === entry.agentId)?.name || entry.agentId}: {entry.active ? "กำลังทำงาน" : "ไม่มีรอบที่กำลังทำ"}{entry.queued ? ` · รอคิว ${entry.queued} งาน` : ""}</li>)}</ul><p className="muted">สถานะอาจเปลี่ยนก่อนเริ่มงาน สมาชิกที่กำลังทำงานรับงานเข้าคิวได้</p></div>}
      {!!task.plan.assignments.length && <div><strong>การกระจายงานที่ขออนุมัติ</strong><ul className="space-y-3 pt-2">{task.plan.assignments.map((assignment, index) => <li key={index}>
        <strong>{state.agents.find((a) => a.id === assignment.agentId)?.name} · {assignment.title}</strong>
        <p className="whitespace-pre-wrap break-words">{assignment.prompt}</p>
        <p className="muted break-words">{assignment.kind === "code" ? "แก้โค้ดใน worktree" : "งานทั่วไป"} · ผลลัพธ์: {assignment.deliverable}</p>
        {assignment.stage && <div className="flex flex-col gap-2"><p>{assignment.stage.kind} · {assignment.stage.reviewRequired ? "รอคุณอนุมัติผลงานก่อนส่งต่อ" : "ส่งต่อเมื่อผ่านเกณฑ์ครบ"}{assignment.stage.repositories.length ? ` · repo: ${assignment.stage.repositories.join(", ")}` : ""}</p><ul className="list-disc pl-5">{assignment.stage.criteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ul></div>}
        {!!assignment.dependsOn?.length && <p className="muted">รอผลจาก: {assignment.dependsOn.map((dependency) => task.plan!.assignments[dependency].title).join(", ")}</p>}
        {(() => {
          const existing = previous.find((item) => item.stage?.key === assignment.stage?.key);
          const delivery = existing?.deliveries?.at(-1);
          if (existing?.stage?.kind === "design" && delivery?.approvedAt) return <fieldset className="space-y-2 pt-2">
            <legend>แบบ v{delivery.revision} อนุมัติแล้ว · เลือกก่อนยืนยันแผน</legend>
            <p>การใช้แบบเดิมจะคงผลงาน เกณฑ์และการอนุมัติเดิมไว้ โดยไม่ใช้การแก้ไขขั้นออกแบบในแผนใหม่นี้</p>
            <label className="flex gap-2"><input type="radio" name={`design-${existing.id}`} checked={designChoices[existing.id] === "reuse"} onChange={() => setDesignChoices((old) => ({ ...old, [existing.id]: "reuse" }))} />ใช้แบบที่อนุมัติแล้ว ไม่ทำขั้นออกแบบซ้ำ</label>
            <label className="flex gap-2"><input type="radio" name={`design-${existing.id}`} checked={designChoices[existing.id] === "rerun"} onChange={() => setDesignChoices((old) => ({ ...old, [existing.id]: "rerun" }))} />ส่งทำแบบใหม่ และรออนุมัติแบบฉบับใหม่</label>
          </fieldset>;
          return task.workflow && <p className="note">{projected[index].label}</p>;
        })()}
      </li>)}</ul></div>}
    </>}
    {schedule && <p className="note">อนุมัติให้ทำซ้ำ: {schedule.frequency === "once" ? `ครั้งเดียว ${schedule.date}` : schedule.frequency === "daily" ? "ทุกวัน" : `ทุกสัปดาห์ วัน${["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"][schedule.weekday]}`} เวลา {schedule.time} · {schedule.timezone} · การเขียน Google ยังขออนุมัติแต่ละครั้ง</p>}
    {intake?.error && <p className="inline-error">{intake.error}</p>}
    {!!missingDesigns.length && <p role="alert" className="inline-error">แผนไม่มีขั้นออกแบบที่อนุมัติแล้ว: {missingDesigns.map((item) => item.title).join(", ")} กรุณาขอให้ Boss คงขั้นเดิมในแผนก่อนยืนยัน</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {task.templateDraft && task.plan && <TemplateDraftEditor key={`${task.id}:${task.planRevision}`} task={task} state={state} action={action} changed={setDirty} />}
    <form className="form" onSubmit={(event) => { event.preventDefault(); void run("task.plan", { id: task.id, body: body.trim() || task.prompt }); }}>
      {!task.templateDraft && <label>ข้อมูลเพิ่มหรือสิ่งที่ต้องการแก้ในแผน<textarea value={body} maxLength={16000} rows={2} disabled={busy || preparing} onChange={(event) => setBody(event.target.value)} /></label>}
      <div className="flex flex-wrap gap-2">
        {!task.templateDraft && <button type="submit" disabled={busy || preparing}>{task.plan ? "ปรับแผน" : "เตรียมแผน"}</button>}
        <button type="button" className="primary" disabled={busy || preparing || !task.plan || !task.planReady || !!body.trim() || dirty || unavailable || !choicesReady} onClick={() => void run("task.confirm", { id: task.id, revision: task.planRevision, ...(approvedDesigns.length ? { designs: approvedDesigns.map((item) => ({ taskId: item.id, revision: item.deliveries!.at(-1)!.revision, fingerprint: item.deliveries!.at(-1)!.fingerprint, decision: designChoices[item.id] })) } : {}) })}>
          {schedule ? "ยืนยันแผนและเปิดตาราง" : "ยืนยันและเริ่มงาน"}
        </button>
        <button type="button" disabled={busy} onClick={() => void run("task.stop", { id: task.id })}>ยกเลิกร่าง</button>
      </div>
    </form>
  </section>;
}
