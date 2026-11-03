"use client";
import { useState } from "react";
import type { Snapshot, Task } from "../shared/types";
import { TaskFiles } from "./TaskFiles";

const stageLabels = { design: "ออกแบบ", work: "ลงมือทำ", review: "ตรวจรวม", summary: "Boss สรุป" };
const phaseLabels = { active: "กำลังดำเนินงาน", acceptance: "รอคุณตรวจรับ", accepted: "ตรวจรับแล้ว รอ merge", closed: "ปิดงานแล้ว", replanning: "รอแผนแก้ไข", interrupted: "ถูกขัดจังหวะ รอตรวจผลงาน" };
type Props = { inTaskSession?: boolean; task: Task; state: Snapshot; action: (name: string, data?: unknown) => Promise<unknown> };

export function WorkflowReview({ task, state, action, inTaskSession }: Props) {
  const [busy, setBusy] = useState(false);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const parent = task.workflow ? task : state.tasks.find((t) => t.id === task.parentTaskId);
  if (!parent?.workflow) return null;
  const workflow = parent.workflow;
  const children = workflow.taskIds.flatMap((id) => state.tasks.find((t) => t.id === id) || []);
  const stages = task.stage ? [task] : children;
  const run = async (target: Task, decision: string, revision: number) => {
    setBusy(true);
    setError("");
    try { await action("workflow.decide", { id: target.id, decision, revision, body: body.trim() || undefined }); setBody(""); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "ดำเนินการไม่ได้"); }
    finally { setBusy(false); }
  };
  return <section aria-label={`ขั้นตอนงาน ${parent.title}`} className="flex min-w-0 flex-col gap-4 rounded-lg border border-[var(--line)] p-4">
    <h3>{parent.title} · {phaseLabels[workflow.phase]}</h3>
    <p className="muted" role="status">แผน workflow v{workflow.revision} · การอนุมัติแบบ การตรวจรับ และ merge เป็นคนละขั้นตอน</p>
    {workflow.reason && <p className="whitespace-pre-wrap break-words">คำขอแก้ไขล่าสุด: {workflow.reason}</p>}
    {stages.map((stage, index) => {
      const delivery = stage.deliveries?.at(-1);
      const waiting = stage.status === "completed" && stage.stage?.reviewRequired && !delivery?.approvedAt;
      return <article key={stage.id} className="flex min-w-0 flex-col gap-3 border-t border-[var(--line)] pt-3">
        <h4>{index + 1}. {stage.title} · {stage.stage && stageLabels[stage.stage.kind]}</h4>
        <p className="muted">{state.agents.find((a) => a.id === stage.agentId)?.name} · {stage.workflowBlocked ? "พักรออนุมัติแผนแก้ไข" : waiting ? "รออนุมัติผลงาน" : stage.activity}</p>
        {stage.error && <p className="inline-error">{stage.error}</p>}
        {stage.stage && <ul className="list-disc pl-5">{stage.stage.criteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ul>}
        {!inTaskSession && stage.deliveries?.map((version) => <details key={version.revision} open={version === delivery}>
          <summary>ผลงาน v{version.revision} · {stage.stage?.reviewRequired ? version.approvedAt ? "อนุมัติแล้ว" : "ยังไม่อนุมัติ" : "ส่งมอบแล้ว"}</summary>
          <pre className="task-output">{version.output}</pre>
          <TaskFiles taskId={stage.id} output={version.output} revision={version.revision} />
          <ul className="flex flex-col gap-2 py-3">{version.checks.map((check) => <li key={check.criterion} className="break-words">
            <strong>{check.status === "passed" ? "ผ่าน" : check.status === "failed" ? "ไม่ผ่าน" : "ยังไม่ได้ตรวจ"}: {check.criterion}</strong><p className="whitespace-pre-wrap">{check.evidence}</p>
          </li>)}</ul>
        </details>)}
        {workflow.phase === "active" && waiting && delivery && <div className="flex flex-wrap gap-2">
          <button className="primary" disabled={busy || !!body.trim()} onClick={() => void run(stage, "approve", delivery.revision)}>อนุมัติ{stage.stage?.kind === "design" ? "แบบ" : "ผลงาน"} v{delivery.revision}</button>
          {!inTaskSession && <button disabled={busy || !body.trim()} onClick={() => void run(stage, "revise", delivery.revision)}>ส่งกลับแก้ไข</button>}
        </div>}
        {!inTaskSession && delivery && workflow.phase !== "closed" && !waiting && <button disabled={busy || !body.trim()} onClick={() => void run(stage, "replan", delivery.revision)}>ขอแก้ขั้นนี้และตรวจแผนใหม่</button>}
      </article>;
    })}
    {workflow.phase !== "closed" && <>
      {!inTaskSession && <label>สิ่งที่ต้องแก้หรือเหตุผลที่ทำต่อ<textarea rows={3} maxLength={16000} value={body} disabled={busy} onChange={(event) => setBody(event.target.value)} /></label>}
      <div className="flex flex-wrap gap-2">
        {workflow.phase === "acceptance" && <button className="primary" disabled={busy || !!body.trim()} onClick={() => void run(parent, "accept", workflow.revision)}>ตรวจรับงานฉบับล่าสุด</button>}
        {workflow.phase === "accepted" && <button className="primary" disabled={busy || children.some((t) => t.worktrees?.some((r) => !r.mergedAt)) || !!body.trim()} onClick={() => void run(parent, "close", workflow.revision)}>ยืนยันปิดงานหลัง merge ครบ</button>}
        {!inTaskSession && workflow.phase !== 'replanning' && <button disabled={busy || !body.trim()} onClick={() => void run(parent, "replan", workflow.revision)}>ให้ Boss เสนอแผนแก้ไข / ทำต่อ</button>}
      </div>
      {workflow.phase === "accepted" && <p className="note">เปิดรายละเอียดงาน ตรวจ diff แล้วอนุมัติ merge แยกแต่ละ repo เมื่อครบจึงปิดงานได้</p>}
    </>}
    {error && <p role="alert" className="inline-error">{error}</p>}
  </section>;
}
