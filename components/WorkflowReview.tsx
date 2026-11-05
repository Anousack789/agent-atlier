"use client";
import { blockedWorkDelivery, deliveryCheckLabel, reviewableWorkDelivery, outstandingWorkChecks, readyWithLimitations, type Delivery, type WorkCheckDecision } from "../shared/workflow";
import { useState } from "react";
import type { Snapshot, Task } from "../shared/types";
import { Dialog } from "./Dialog";
import { HumanReviewEvidence, SummarySources, TaskFiles } from "./TaskFiles";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

const stageLabels = { design: "ออกแบบ", work: "ลงมือทำ", review: "ตรวจรวม", summary: "Boss สรุป" };
const phaseLabels = { active: "กำลังดำเนินงาน", acceptance: "รอคุณตรวจรับ", accepted: "ตรวจรับแล้ว รอ merge", closed: "ปิดงานแล้ว", replanning: "รอแผนแก้ไข", interrupted: "ถูกขัดจังหวะ รอตรวจผลงาน" };
type Props = { inTaskSession?: boolean; task: Task; state: Snapshot; action: (name: string, data?: unknown) => Promise<unknown> };

function WorkReview({ task, delivery, busy, submit }: {
  task: Task; delivery: Delivery; busy: boolean; submit: (checks: WorkCheckDecision[]) => void;
}) {
  const [decisions, setDecisions] = useState(new Map<string, WorkCheckDecision>());
  const outstanding = outstandingWorkChecks(delivery);
  const checks = outstanding.flatMap(({ criterion }) => decisions.get(criterion) || []);
  return <section className="flex min-w-0 flex-col gap-3" aria-label={`ยืนยันผลงาน v${delivery.revision}`}>
    <h5>{readyWithLimitations} · ผลงาน v{delivery.revision}</h5>
    <p className="whitespace-pre-wrap break-words">{delivery.incomplete?.remaining}</p>
    <pre className="task-output">{delivery.output}</pre>
    <TaskFiles taskId={task.id} output={delivery.output} revision={delivery.revision} />
    {!!task.worktrees?.length && <div className="flex flex-wrap gap-2">
      {task.worktrees.map((repo) => {
        const query = new URLSearchParams({ id: task.id, repositoryId: repo.id, deliveryFingerprint: delivery.fingerprint });
        return <a key={repo.id} className="diff-link" href={`/diff?${query}`} target="_blank" rel="noopener noreferrer">ดู diff · {repo.name}</a>;
      })}
    </div>}
    {outstanding.map(({ criterion, evidence, status }) => {
      const choice = decisions.get(criterion);
      return <fieldset key={criterion} disabled={busy} className="flex min-w-0 flex-col gap-2">
        <legend className="break-words">{criterion}</legend>
        <p className="whitespace-pre-wrap break-words">{status === "failed" ? "ยังไม่ผ่าน" : "ยังไม่ได้ยืนยัน"} · {evidence}</p>
        <Select value={choice?.outcome || ""} onValueChange={(value: WorkCheckDecision["outcome"]) =>
          setDecisions(new Map(decisions).set(criterion, { criterion, outcome: value, evidence: choice?.evidence || "" }))}>
          <SelectTrigger aria-label={`คำตัดสินสำหรับ ${criterion}`}><SelectValue placeholder="เลือกคำตัดสิน" /></SelectTrigger>
          <SelectContent>
            {status === "unverified" && <SelectItem value="verified">ตรวจเองแล้วผ่าน</SelectItem>}
            <SelectItem value="riskAccepted">ยอมรับความเสี่ยงและส่งต่อ</SelectItem>
          </SelectContent>
        </Select>
        {choice && <label>ผลตรวจหรือเหตุผล<textarea rows={2} maxLength={16000} value={choice.evidence}
          onChange={(event) => setDecisions(new Map(decisions).set(criterion, { ...choice, evidence: event.target.value }))} /></label>}
      </fieldset>;
    })}
    <button className="primary" type="button" disabled={busy || checks.length !== outstanding.length || checks.some((check) => !check.evidence.trim())}
      onClick={() => submit(checks)}>ยืนยันผลตรวจและส่งต่อ v{delivery.revision}</button>
  </section>;
}

function RejectWork({ task, delivery, action }: { task: Task; delivery: Delivery; action: Props["action"] }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <>
    <button className="danger-outline self-start" onClick={() => setOpen(true)}>ตัดสินว่างานไม่ผ่าน</button>
    {open && <Dialog title="ยืนยันตัดสินว่างานไม่ผ่าน" close={() => { if (!busy) setOpen(false); }}>
      <form className="flex flex-col gap-3" onSubmit={async (event) => {
        event.preventDefault();
        if (busy || !reason.trim()) return;
        setBusy(true);
        setError("");
        try {
          await action("workflow.decide", {
            id: task.id, decision: "failWork", revision: delivery.revision,
            fingerprint: delivery.fingerprint, body: reason.trim(),
          });
          setOpen(false);
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : "บันทึกการตัดสินไม่ได้");
        } finally {
          setBusy(false);
        }
      }}>
        <p>{task.title} · ผลงาน v{delivery.revision}</p>
        <p>ระบบจะบันทึกว่างานไม่ผ่านและเก็บผลงานไว้ให้ตรวจและปรับแผนต่อได้</p>
        <label>เหตุผลที่งานไม่ผ่าน<textarea className="block w-full" rows={3} required maxLength={16000} value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} /></label>
        {error && <p role="alert" className="inline-error">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => setOpen(false)}>กลับไปตรวจงาน</button>
          <button type="submit" className="danger-outline" disabled={busy || !reason.trim()}>ยืนยันว่างานไม่ผ่าน</button>
        </div>
      </form>
    </Dialog>}
  </>;
}

export function WorkflowReview({ task, state, action, inTaskSession }: Props) {
  const [busy, setBusy] = useState(false);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const parent = task.workflow ? task : state.tasks.find((t) => t.id === task.parentTaskId);
  if (!parent?.workflow) return null;
  const workflow = parent.workflow;
  const children = workflow.taskIds.flatMap((id) => state.tasks.find((t) => t.id === id) || []);
  const stages = task.stage ? [task] : children;
  const run = async (target: Task, decision: string, revision: number, review?: { fingerprint: string; checks: WorkCheckDecision[] }) => {
    setBusy(true);
    setError("");
    try { await action("workflow.decide", { id: target.id, decision, revision, body: review ? undefined : body.trim() || undefined, ...review }); setBody(""); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "ดำเนินการไม่ได้"); }
    finally { setBusy(false); }
  };
  return <section aria-label={`ขั้นตอนงาน ${parent.title}`} className="flex min-w-0 flex-col gap-4 rounded-lg border border-[var(--line)] p-4">
    <h3>{parent.title} · {phaseLabels[workflow.phase]}</h3>
    <p className="muted" role="status">แผน workflow v{workflow.revision} · การอนุมัติแบบ การตรวจรับ และ merge เป็นคนละขั้นตอน</p>
    {workflow.reason && <p className="whitespace-pre-wrap break-words">คำขอแก้ไขล่าสุด: {workflow.reason}</p>}
    {stages.map((stage, index) => {
      const delivery = stage.deliveries?.at(-1);
      const candidate = workflow.phase === "active" && parent.status === "waiting" ? reviewableWorkDelivery(stage) : undefined;
      const incomplete = workflow.phase === "active" && parent.status === "waiting" && stage.status === "paused" &&
        stage.approvedRevision && parent.approvedRevision === parent.planRevision && !stage.workflowBlocked &&
        !children.some((child) => child.mergedAt || child.worktrees?.some((tree) => tree.mergedAt))
        ? blockedWorkDelivery(stage) : undefined;
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
            <strong>{deliveryCheckLabel(stage, version, check)}: {check.criterion}</strong><p className="whitespace-pre-wrap">{check.evidence}</p>
          </li>)}</ul>
          <HumanReviewEvidence delivery={version} />
          {stage.stage?.kind === "summary" && <SummarySources delivery={version} tasks={children} />}
        </details>)}
        {incomplete && <RejectWork key={incomplete.fingerprint} task={stage} delivery={incomplete} action={action} />}
        {stage.deliveries?.filter((version) => version.humanRejection).map((version) =>
          <p key={version.revision} className="whitespace-pre-wrap break-words"><strong>ผู้ใช้ตัดสินว่างานไม่ผ่าน · v{version.revision}</strong> · {version.humanRejection!.reason}</p>)}
        {candidate && <WorkReview key={candidate.fingerprint} task={stage} delivery={candidate} busy={busy}
          submit={(checks) => void run(stage, "reviewWork", candidate.revision, { fingerprint: candidate.fingerprint, checks })} />}
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
